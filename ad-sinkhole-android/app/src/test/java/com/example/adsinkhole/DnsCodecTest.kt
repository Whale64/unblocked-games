package com.example.adsinkhole

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream

class DnsCodecTest {

    /** Builds a standard A-record query for [name] with the given transaction id. */
    private fun query(name: String, id: Int = 0x1234): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(id shr 8)
        out.write(id and 0xFF)
        out.write(0x01) // flags: RD
        out.write(0x00)
        out.write(0x00) // QDCOUNT = 1
        out.write(0x01)
        repeat(6) { out.write(0) } // ANCOUNT, NSCOUNT, ARCOUNT
        for (label in name.split('.')) {
            out.write(label.length)
            out.write(label.toByteArray())
        }
        out.write(0) // root
        out.write(0x00)
        out.write(0x01) // QTYPE A
        out.write(0x00)
        out.write(0x01) // QCLASS IN
        return out.toByteArray()
    }

    @Test
    fun parsesQueryNameLowercased() {
        val q = query("Ads.Example.COM")
        val parsed = DnsCodec.parseQuery(q)
        assertNotNull(parsed)
        assertEquals("ads.example.com", parsed!!.name)
        assertEquals(q.size, parsed.questionEnd)
    }

    @Test
    fun ignoresResponses() {
        val q = query("example.com")
        q[2] = (q[2].toInt() or 0x80).toByte() // set QR
        assertNull(DnsCodec.parseQuery(q))
    }

    @Test
    fun nxdomainKeepsIdAndQuestionAndSetsRcode() {
        val q = query("tracker.example.net", id = 0xBEEF)
        val parsed = DnsCodec.parseQuery(q)!!
        val reply = DnsCodec.buildDnsError(q, parsed.questionEnd, DnsCodec.RCODE_NXDOMAIN)

        assertEquals(0xBEEF, DnsCodec.u16(reply, 0))
        assertTrue("QR bit should be set", (reply[2].toInt() and 0x80) != 0)
        assertEquals(DnsCodec.RCODE_NXDOMAIN, reply[3].toInt() and 0x0F)
        assertEquals(0, DnsCodec.u16(reply, 6)) // ANCOUNT
        assertEquals(q.size, reply.size) // no extra records appended
    }

    @Test
    fun ipUdpRoundTripAndHeaderChecksum() {
        val client = byteArrayOf(10, 111, 222.toByte(), 2)
        val fakeDns = byteArrayOf(10, 111, 222.toByte(), 1)
        val payload = query("example.com")

        val packet = DnsCodec.buildIpv4Udp(client, fakeDns, 50000, DnsCodec.DNS_PORT, payload)
        val dgram = DnsCodec.parseIpv4Udp(packet, packet.size)

        assertNotNull(dgram)
        assertArrayEquals(payload, dgram!!.payload)
        assertArrayEquals(client, dgram.srcIp)
        assertArrayEquals(fakeDns, dgram.dstIp)
        assertEquals(50000, dgram.srcPort)
        assertEquals(DnsCodec.DNS_PORT, dgram.dstPort)
        // A valid IPv4 header sums to zero when its checksum field is included.
        assertEquals(0, DnsCodec.checksum(packet, 0, 20))
    }

    @Test
    fun rejectsNonUdpPackets() {
        val packet = DnsCodec.buildIpv4Udp(byteArrayOf(1, 2, 3, 4), byteArrayOf(5, 6, 7, 8), 1, 53, ByteArray(12))
        packet[9] = 6 // TCP
        assertNull(DnsCodec.parseIpv4Udp(packet, packet.size))
    }
}
