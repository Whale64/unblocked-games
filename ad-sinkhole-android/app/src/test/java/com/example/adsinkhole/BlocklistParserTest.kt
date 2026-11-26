package com.example.adsinkhole

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BlocklistParserTest {

    @Test
    fun parsesHostsLines() {
        assertEquals("ads.example.com", BlocklistParser.parseLine("0.0.0.0 ads.example.com"))
        assertEquals("ads.example.com", BlocklistParser.parseLine("127.0.0.1\tADS.example.com  # comment"))
    }

    @Test
    fun parsesPlainDomainLines() {
        assertEquals("tracker.net", BlocklistParser.parseLine("tracker.net"))
    }

    @Test
    fun parsesSimpleAdblockRules() {
        assertEquals("ads.example.org", BlocklistParser.parseLine("||ads.example.org^"))
    }

    @Test
    fun skipsRulesWithModifiersOrExceptions() {
        assertNull(BlocklistParser.parseLine("||ads.example.org^\$third-party"))
        assertNull(BlocklistParser.parseLine("@@||safe.example.org^"))
    }

    @Test
    fun skipsCommentsCosmeticRulesAndLocalhost() {
        assertNull(BlocklistParser.parseLine("! Title: some list"))
        assertNull(BlocklistParser.parseLine("# comment"))
        assertNull(BlocklistParser.parseLine("example.com##.banner"))
        assertNull(BlocklistParser.parseLine("0.0.0.0 0.0.0.0"))
        assertNull(BlocklistParser.parseLine("127.0.0.1 localhost"))
        assertNull(BlocklistParser.parseLine(""))
    }

    @Test
    fun matchesSubdomainsOfListedDomains() {
        val set = setOf("ads.com")
        assertTrue(BlocklistParser.isListed("ads.com", set))
        assertTrue(BlocklistParser.isListed("eu.cdn.ads.com", set))
        assertFalse(BlocklistParser.isListed("notads.com", set))
        assertFalse(BlocklistParser.isListed("ads.com.evil.net", set))
        assertFalse(BlocklistParser.isListed("", set))
    }

    @Test
    fun normalisesAllowlistEntries() {
        assertEquals("example.com", BlocklistParser.normalizeAllowEntry("  *.Example.com. "))
        assertNull(BlocklistParser.normalizeAllowEntry("not a domain"))
    }
}
