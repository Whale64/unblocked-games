package com.example.adsinkhole

import android.content.Context
import java.util.concurrent.atomic.AtomicLong

/**
 * Cumulative blocking statistics, kept across restarts.
 *
 * The block lists don't say whether an entry is an ad or a tracker, so the split is an
 * estimate made from the domain name (see [classify]). The total is exact.
 */
object Stats {
    enum class Category { ADS, TRACKER, OTHER }

    private const val PREFS = "adsinkhole"
    private const val KEY_ADS = "stats.ads"
    private const val KEY_TRACKERS = "stats.trackers"
    private const val KEY_OTHER = "stats.other"
    private const val KEY_ALLOWED = "stats.allowed"

    private val adsCount = AtomicLong()
    private val trackerCount = AtomicLong()
    private val otherCount = AtomicLong()
    private val allowedCount = AtomicLong()

    @Volatile
    private var loaded = false

    private val adLabels = setOf("ad", "ads", "adserver", "adservice", "adsrv", "adx", "adsystem")
    private val adFragments = listOf(
        "adserv", "adsystem", "adnxs", "doubleclick", "googlesyndication", "adsense", "advert",
        "banner", "criteo", "pubmatic", "taboola", "outbrain", "adform", "applovin", "mopub",
        "unityads", "admob", "adcolony", "popad", "popup",
    )
    private val trackerFragments = listOf(
        "track", "analytic", "metric", "telemetry", "pixel", "beacon", "stats", "sentry",
        "crash", "mixpanel", "segment", "hotjar", "scorecard", "insight", "measure", "fingerprint",
    )

    val ads: Long get() = adsCount.get()
    val trackers: Long get() = trackerCount.get()
    val other: Long get() = otherCount.get()
    val allowed: Long get() = allowedCount.get()
    val totalBlocked: Long get() = ads + trackers + other

    @Synchronized
    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        adsCount.set(prefs.getLong(KEY_ADS, 0L))
        trackerCount.set(prefs.getLong(KEY_TRACKERS, 0L))
        otherCount.set(prefs.getLong(KEY_OTHER, 0L))
        allowedCount.set(prefs.getLong(KEY_ALLOWED, 0L))
    }

    fun recordBlocked(domain: String) {
        when (classify(domain)) {
            Category.ADS -> adsCount.incrementAndGet()
            Category.TRACKER -> trackerCount.incrementAndGet()
            Category.OTHER -> otherCount.incrementAndGet()
        }
    }

    fun recordAllowed() {
        allowedCount.incrementAndGet()
    }

    /** Writes the current counts to disk. Called periodically while the VPN runs, and on stop. */
    fun flush(context: Context) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(KEY_ADS, ads)
            .putLong(KEY_TRACKERS, trackers)
            .putLong(KEY_OTHER, other)
            .putLong(KEY_ALLOWED, allowed)
            .apply()
    }

    fun reset(context: Context) {
        adsCount.set(0)
        trackerCount.set(0)
        otherCount.set(0)
        allowedCount.set(0)
        flush(context)
    }

    /** Best-effort guess at whether a blocked domain is an ad, a tracker, or neither. */
    fun classify(domain: String): Category {
        val d = domain.lowercase()
        val labels = d.split('.')
        if (labels.any { it in adLabels } || adFragments.any { d.contains(it) }) return Category.ADS
        if (trackerFragments.any { d.contains(it) }) return Category.TRACKER
        return Category.OTHER
    }
}
