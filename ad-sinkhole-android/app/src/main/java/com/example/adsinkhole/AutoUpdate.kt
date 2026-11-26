package com.example.adsinkhole

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Schedules a block-list refresh every 7 days while the user has auto-update enabled.
 * WorkManager keeps the schedule across reboots and app restarts.
 */
object AutoUpdate {
    private const val WORK_NAME = "blocklist-auto-update"
    private const val INTERVAL_DAYS = 7L

    /** Brings the schedule in line with the auto-update setting. Safe to call repeatedly. */
    fun apply(context: Context) {
        val workManager = WorkManager.getInstance(context.applicationContext)
        if (!Settings.autoUpdate(context)) {
            workManager.cancelUniqueWork(WORK_NAME)
            return
        }
        val request = PeriodicWorkRequestBuilder<BlocklistUpdateWorker>(INTERVAL_DAYS, TimeUnit.DAYS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        // KEEP: re-applying must not reset the 7-day countdown.
        workManager.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }
}

class BlocklistUpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result =
        try {
            Blocklist.update(applicationContext)
            Result.success()
        } catch (e: Exception) {
            // Network hiccup or all sources down: try again later, with WorkManager's backoff.
            Result.retry()
        }
}
