package com.example.adsinkhole

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.example.adsinkhole.databinding.ActivityStatsBinding
import java.text.NumberFormat

class StatsActivity : AppCompatActivity() {

    private lateinit var ui: ActivityStatsBinding
    private val handler = Handler(Looper.getMainLooper())
    private val refresher = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = ActivityStatsBinding.inflate(layoutInflater)
        setContentView(ui.root)
        setSupportActionBar(ui.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        Stats.load(this)
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresher)
    }

    override fun onPause() {
        handler.removeCallbacks(refresher)
        super.onPause()
    }

    private fun render() {
        val fmt = NumberFormat.getIntegerInstance()
        ui.totalValue.text = fmt.format(Stats.totalBlocked)
        ui.adsValue.text = fmt.format(Stats.ads)
        ui.trackersValue.text = fmt.format(Stats.trackers)
        ui.otherValue.text = fmt.format(Stats.other)
        ui.allowedValue.text = fmt.format(Stats.allowed)
    }
}
