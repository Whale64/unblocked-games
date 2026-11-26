package com.example.adsinkhole

import java.util.concurrent.atomic.AtomicInteger

/**
 * Android-free helpers for the packet formats the tunnel handles:
 * IPv4 -> UDP -> DNS. Kept pure so they can be unit-tested on the JVM.
 */
object DnsCodec {
    const val PROTO_UDP = 17
    const val DNS_PORT = 53
    const val RCODE_SERVFAIL = 2
    const val RCODE_NXDOMAIN = 3

    private const val IPV4_HEADER = 20
    private const val UDP_HEADER = 8
    private const val DNS_HEADER = 12

    private val ipIdentification = AtomicInteger(0)

    class UdpDatagram(
        val srcIp: ByteArray,
        val dstIp: ByteArray,
        val srcPort: Int,
        val dstPort: Int,
        val payload: ByteArray,
    )

    /** A parsed DNS query: the lowercase name and the offset just past its question section. */
    class DnsQuery(val name: String, val questionEnd: Int)

    /** Returns the UDP datagram carried by an IPv4 packet, or null if it is anything else. */
    fun parseIpv4Udp(packet: ByteArray, length: Int): UdpDatagram? {
        if (length < IPV4_HEADER + UDP_HEADER) return null
        if ((packet[0].toInt() shr 4) != 4) return null
        val ihl = (packet[0].toInt() and 0x0F) * 4
        if (ihl < IPV4_HEADER || length < ihl + UDP_HEADER) return null
        if ((packet[9].toInt() and 0xFF) != PROTO_UDP) return null

        val totalLen = u16(packet, 2).coerceAtMost(length)
        val udpLen = u16(packet, ihl + 4)
        if (udpLen < UDP_HEADER) return null
        val start = ihl + UDP_HEADER
        val end = (ihl + udpLen).coerceAtMost(totalLen)
        if (end < start) return null

        return UdpDatagram(
            srcIp = packet.copyOfRange(12, 16),
            dstIp = packet.copyOfRange(16, 20),
            srcPort = u16(packet, ihl),
            dstPort = u16(packet, ihl + 2),
            payload = packet.copyOfRange(start, end),
        )
    }

    /** Wraps a UDP payload in an IPv4 + UDP packet from src:srcPort to dst:dstPort. */
    fun buildIpv4Udp(
        srcIp: ByteArray,
        dstIp: ByteArray,
        srcPort: Int,
        dstPort: Int,
        payload: ByteArray,
    ): ByteArray {
        val total = IPV4_HEADER + UDP_HEADER + payload.size
        val out = ByteArray(total)
        out[0] = 0x45 // IPv4, 20-byte header
        putU16(out, 2, total)
        putU16(out, 4, ipIdentification.incrementAndGet() and 0xFFFF)
        putU16(out, 6, 0x4000) // don't fragment
        out[8] = 64 // TTL
        out[9] = PROTO_UDP.toByte()
        srcIp.copyInto(out, 12)
        dstIp.copyInto(out, 16)
        putU16(out, 20, srcPort)
        putU16(out, 22, dstPort)
        putU16(out, 24, UDP_HEADER + payload.size)
        // UDP checksum (bytes 26-27) stays 0: it is optional over IPv4.
        payload.copyInto(out, IPV4_HEADER + UDP_HEADER)
        putU16(out, 10, checksum(out, 0, IPV4_HEADER))
        return out
    }

    /** Parses the first question of a DNS query. Returns null for responses or anything malformed. */
    fun parseQuery(dns: ByteArray): DnsQuery? {
        if (dns.size < DNS_HEADER + 5) return null
        val flags = u16(dns, 2)
        if ((flags and 0x8000) != 0) return null // QR=1 means this is a response
        if (((flags shr 11) and 0x0F) != 0) return null // only standard queries (opcode 0)
        if (u16(dns, 4) < 1) return null // QDCOUNT
        val (name, after) = readName(dns, DNS_HEADER) ?: return null
        if (after + 4 > dns.size) return null // QTYPE + QCLASS must fit
        return DnsQuery(name, after + 4)
    }

    /**
     * Turns a query into a reply carrying only the header and question with the given RCODE.
     * Used for NXDOMAIN (blocked) and SERVFAIL (upstream unreachable).
     */
    fun buildDnsError(query: ByteArray, questionEnd: Int, rcode: Int): ByteArray {
        val out = query.copyOf(questionEnd)
        out[2] = (out[2].toInt() or 0x80).toByte() // QR = response, keep opcode and RD
        out[3] = (0x80 or rcode).toByte() // RA = recursion available
        for (i in 6 until 12) out[i] = 0 // ANCOUNT, NSCOUNT, ARCOUNT
        return out
    }

    /** Internet checksum (RFC 1071) over b[off until off+len]. Returns 0 for a valid header. */
    fun checksum(b: ByteArray, off: Int, len: Int): Int {
        var sum = 0L
        var i = 0
        while (i < len) {
            val hi = b[off + i].toInt() and 0xFF
            val lo = if (i + 1 < len) b[off + i + 1].toInt() and 0xFF else 0
            sum += (hi shl 8) or lo
            i += 2
        }
        while ((sum shr 16) != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum.toInt().inv() and 0xFFFF
    }

    fun u16(b: ByteArray, off: Int): Int =
        ((b[off].toInt() and 0xFF) shl 8) or (b[off + 1].toInt() and 0xFF)

    private fun putU16(b: ByteArray, off: Int, v: Int) {
        b[off] = (v shr 8).toByte()
        b[off + 1] = v.toByte()
    }

    /** Reads an uncompressed DNS name starting at [start]. Returns (lowercase name, offset after it). */
    private fun readName(dns: ByteArray, start: Int): Pair<String, Int>? {
        val sb = StringBuilder()
        var pos = start
        while (true) {
            if (pos >= dns.size) return null
            val len = dns[pos].toInt() and 0xFF
            if (len == 0) return sb.toString().lowercase() to (pos + 1)
            // Compression pointers (top two bits set) never appear in a question; reject them.
            if ((len and 0xC0) != 0 || pos + 1 + len > dns.size) return null
            if (sb.isNotEmpty()) sb.append('.')
            for (i in 1..len) sb.append((dns[pos + i].toInt() and 0xFF).toChar())
            pos += len + 1
        }
    }
}
