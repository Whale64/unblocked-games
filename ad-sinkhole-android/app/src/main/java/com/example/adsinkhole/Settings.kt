package com.example.adsinkhole

import android.content.Context

/** Small preference store shared by the UI and the VPN service. */
object Settings {
    private const val PREFS = "adsinkhole"
    private const val KEY_ALLOWLIST = "allowlist"
    private const val KEY_UPSTREAM = "upstream"
    private const val KEY_LAST_UPDATED = "lastUpdated"
    private const val KEY_DOMAIN_COUNT = "domainCount"
    private const val KEY_AUTO_UPDATE = "autoUpdate"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Auto-update is on by default: the block lists refresh every 7 days. */
    fun autoUpdate(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_UPDATE, true)

    fun setAutoUpdate(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_AUTO_UPDATE, enabled).apply()
    }

    fun allowlistText(context: Context): String = prefs(context).getString(KEY_ALLOWLIST, "") ?: ""

    fun saveAllowlist(context: Context, text: String) {
        prefs(context).edit().putString(KEY_ALLOWLIST, text).apply()
    }

    fun allowlist(context: Context): Set<String> =
        allowlistText(context).lineSequence()
            .mapNotNull(BlocklistParser::normalizeAllowEntry)
            .toSet()

    /** Upstream resolvers as IP literals, tried in order. */
    fun upstreamServers(context: Context): List<String> =
        (prefs(context).getString(KEY_UPSTREAM, "1.1.1.1,8.8.8.8") ?: "")
            .split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }

    fun lastUpdated(context: Context): Long = prefs(context).getLong(KEY_LAST_UPDATED, 0L)

    fun domainCount(context: Context): Int = prefs(context).getInt(KEY_DOMAIN_COUNT, 0)

    fun recordUpdate(context: Context, domainCount: Int) {
        prefs(context).edit()
            .putLong(KEY_LAST_UPDATED, System.currentTimeMillis())
            .putInt(KEY_DOMAIN_COUNT, domainCount)
            .apply()
    }
}
