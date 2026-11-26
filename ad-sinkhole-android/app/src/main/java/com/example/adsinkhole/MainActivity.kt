package com.example.adsinkhole

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Menu
import android.view.MenuItem
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.example.adsinkhole.databinding.ActivityMainBinding
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Date

class MainActivity : AppCompatActivity() {

    private lateinit var ui: ActivityMainBinding
    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var updating = false

    private val refresher = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 1000)
        }
    }

    private val vpnConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) startShield() else toast("VPN permission was declined")
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = ActivityMainBinding.inflate(layoutInflater)
        setContentView(ui.root)
        setSupportActionBar(ui.toolbar)
        Stats.load(this)

        ui.allowlistInput.setText(Settings.allowlistText(this))
        ui.autoUpdateSwitch.isChecked = Settings.autoUpdate(this)
        ui.autoUpdateSwitch.setOnCheckedChangeListener { _, checked ->
            Settings.setAutoUpdate(this, checked)
            AutoUpdate.apply(this)
        }
        AutoUpdate.apply(this)

        ui.toggleButton.setOnClickListener {
            if (AdBlockVpnService.isRunning) stopShield() else requestStart()
        }
        ui.updateButton.setOnClickListener { updateLists() }
        ui.saveAllowlistButton.setOnClickListener { saveAllowlist() }

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.action_statistics -> {
            startActivity(Intent(this, StatsActivity::class.java))
            true
        }
        R.id.action_reset_statistics -> {
            confirmReset()
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresher)
    }

    override fun onPause() {
        handler.removeCallbacks(refresher)
        super.onPause()
    }

    private fun confirmReset() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.reset_title)
            .setMessage(R.string.reset_message)
            .setPositiveButton(R.string.reset_confirm) { _, _ ->
                Stats.reset(this)
                render()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun requestStart() {
        val consent = VpnService.prepare(this)
        if (consent != null) vpnConsent.launch(consent) else startShield()
    }

    private fun startShield() {
        ContextCompat.startForegroundService(
            this,
            Intent(this, AdBlockVpnService::class.java).setAction(AdBlockVpnService.ACTION_START),
        )
    }

    private fun stopShield() {
        startService(Intent(this, AdBlockVpnService::class.java).setAction(AdBlockVpnService.ACTION_STOP))
    }

    private fun updateLists() {
        updating = true
        ui.updateButton.isEnabled = false
        ui.listInfo.text = "Downloading block lists…"
        val app = applicationContext
        Thread {
            val message = try {
                val result = Blocklist.update(app)
                val suffix = if (result.failures.isEmpty()) "" else " (some sources failed)"
                "Loaded ${result.domainCount} domains$suffix"
            } catch (e: Exception) {
                "Update failed: ${e.message}"
            }
            runOnUiThread {
                updating = false
                ui.updateButton.isEnabled = true
                toast(message)
                render()
            }
        }.start()
    }

    private fun saveAllowlist() {
        Settings.saveAllowlist(this, ui.allowlistInput.text.toString())
        if (AdBlockVpnService.isRunning) {
            startService(Intent(this, AdBlockVpnService::class.java).setAction(AdBlockVpnService.ACTION_RELOAD))
        }
        toast("Allowlist saved")
    }

    private fun render() {
        val on = AdBlockVpnService.isRunning
        val fmt = NumberFormat.getIntegerInstance()
        ui.statusText.text = if (on) "Protection is ON" else "Protection is OFF"
        ui.toggleButton.text = if (on) "Stop protection" else "Start protection"
        ui.statsText.text = "Ads and trackers blocked: ${fmt.format(Stats.totalBlocked)}"

        if (!updating) {
            val updated = Settings.lastUpdated(this)
            ui.listInfo.text = if (updated == 0L) {
                "No block list yet. Tap Update lists."
            } else {
                "${fmt.format(Settings.domainCount(this))} domains, updated " +
                    DateFormat.getDateTimeInstance().format(Date(updated))
            }
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
