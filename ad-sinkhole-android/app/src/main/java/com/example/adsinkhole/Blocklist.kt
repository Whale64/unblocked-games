package com.example.adsinkhole

import android.content.Context
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Process-wide holder for the set of blocked domains, persisted to app storage. */
object Blocklist {
    /** Public, well-known lists. Edit this list to use different sources. */
    val SOURCES = listOf(
        // AdGuard DNS filter (ads, trackers, telemetry)
        "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt",
        // Unified hosts: ads, trackers and malware
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
        // HaGeZi Multi PRO: broad ads, tracking, telemetry, malware and scam coverage
        "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt",
        // OISD Big: large general-purpose ad and tracker list
        "https://big.oisd.nl/",
    )

    private const val FILE_NAME = "blocklist.txt"
    private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

    class UpdateResult(val domainCount: Int, val failures: List<String>)

    /** Read on every DNS query, so updates take effect without restarting the tunnel. */
    @Volatile
    var domains: Set<String> = emptySet()
        private set

    @Volatile
    private var loaded = false

    // Separate locks: loading (needed by the VPN) must never wait for a slow download.
    private val loadLock = Any()
    private val updateLock = Any()

    /**
     * Reads the saved list from disk. Parsing hundreds of thousands of lines is slow, so call
     * this from a background thread, never from the UI thread.
     */
    fun ensureLoaded(context: Context) {
        synchronized(loadLock) {
            if (loaded) return
            val file = File(context.applicationContext.filesDir, FILE_NAME)
            if (file.exists()) {
                domains = file.bufferedReader().useLines { lines ->
                    lines.filter { it.isNotBlank() }.toHashSet()
                }
            }
            loaded = true
        }
    }

    fun isStale(context: Context): Boolean =
        domains.isEmpty() || System.currentTimeMillis() - Settings.lastUpdated(context) > MAX_AGE_MS

    /**
     * Downloads every source and replaces the current list. A single failing source
     * does not abort the update; it is reported in [UpdateResult.failures].
     * Must be called off the main thread.
     */
    @Throws(IOException::class)
    fun update(context: Context): UpdateResult = synchronized(updateLock) {
        val app = context.applicationContext
        val collected = HashSet<String>(600_000)
        val failures = mutableListOf<String>()

        for (url in SOURCES) {
            try {
                download(url, collected)
            } catch (e: Exception) {
                failures += "$url (${e.message})"
            }
        }
        if (collected.isEmpty()) {
            throw IOException("No list could be downloaded: ${failures.joinToString("; ")}")
        }

        val target = File(app.filesDir, FILE_NAME)
        val tmp = File(app.filesDir, "$FILE_NAME.tmp")
        tmp.bufferedWriter().use { w ->
            for (d in collected) {
                w.write(d)
                w.newLine()
            }
        }
        if (!tmp.renameTo(target)) throw IOException("Could not save block list")

        domains = collected
        loaded = true
        Settings.recordUpdate(app, collected.size)
        UpdateResult(collected.size, failures)
    }

    private fun download(url: String, into: MutableSet<String>) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("User-Agent", "ZeroAd/1.0")
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("HTTP ${conn.responseCode}")
            }
            conn.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line -> BlocklistParser.parseLine(line)?.let(into::add) }
            }
        } finally {
            conn.disconnect()
        }
    }
}
