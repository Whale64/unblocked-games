package com.example.adsinkhole

import com.example.adsinkhole.Stats.Category
import org.junit.Assert.assertEquals
import org.junit.Test

class StatsClassifierTest {

    @Test
    fun classifiesAdDomains() {
        assertEquals(Category.ADS, Stats.classify("ad.example.com"))
        assertEquals(Category.ADS, Stats.classify("securepubads.g.doubleclick.net"))
        assertEquals(Category.ADS, Stats.classify("pagead2.googlesyndication.com"))
        assertEquals(Category.ADS, Stats.classify("ads.somesite.org"))
    }

    @Test
    fun classifiesTrackerDomains() {
        assertEquals(Category.TRACKER, Stats.classify("www.google-analytics.com"))
        assertEquals(Category.TRACKER, Stats.classify("api.mixpanel.com"))
        assertEquals(Category.TRACKER, Stats.classify("telemetry.example.net"))
    }

    @Test
    fun everythingElseIsOther() {
        assertEquals(Category.OTHER, Stats.classify("malware-host.example"))
        assertEquals(Category.OTHER, Stats.classify("example.com"))
    }
}
