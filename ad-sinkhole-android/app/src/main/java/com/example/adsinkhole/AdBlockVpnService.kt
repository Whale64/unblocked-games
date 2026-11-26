package com.example.adsinkhole

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * DNS-level ad blocker built on VpnService.
 *
 * Only one address is routed into the tunnel: a fake DNS server ([FAKE_DNS]) that is
 * handed to the system as its resolver. Every DNS query therefore lands here. Queries for
 * blocked domains get an NXDOMAIN reply. Everything else is forwarded to a real upstream
 * resolver through a socket that is protected from the tunnel. All other traffic never
 * enters the tunnel, so it is not slowed down or inspected.
 */
class AdBlockVpnService : VpnService() {

    companion object {
        private const val TAG = "AdSinkholeVpn"

        const val ACTION_START = "com.example.adsinkhole.START"
        const val ACTION_STOP = "com.example.adsinkhole.STOP"
        const val ACTION_RELOAD = "com.example.adsinkhole.RELOAD"

        private const val VPN_ADDRESS = "10.111.222.2"
        private const val FAKE_DNS = "10.111.222.1"
        private const val CHANNEL_ID = "protection"
        private const val NOTIFICATION_ID = 1
        private const val UPSTREAM_TIMEOUT_MS = 4000
        private const val FORWARDER_THREADS = 8

        @Volatile
        var isRunning = false
            private set

        val blockedCount = AtomicLong()
        val forwardedCount = AtomicLong()
    }

    private val fakeDnsBytes: ByteArray by lazy { InetAddress.getByName(FAKE_DNS).address }
    private val forwarder: ExecutorService = Executors.newFixedThreadPool(FORWARDER_THREADS)
    private val writeLock = Any()

    private var tunnel: ParcelFileDescriptor? = null
    private var tunnelOut: FileOutputStream? = null
    private var reader: Thread? = null

    @Volatile
    private var allowlist: Set<String> = emptySet()

    @Volatile
    private var upstreams: List<InetAddress> = emptyList()

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTunnel()
                stopSelf()
            }
            ACTION_RELOAD -> loadAllowlist()
            else -> {
                // Must be called promptly after startForegroundService().
                startForeground(NOTIFICATION_ID, buildNotification())
                startTunnel()
            }
        }
        return START_STICKY
    }

    override fun onRevoke() {
        // The user switched to another VPN or turned this one off in system settings.
        stopTunnel()
        stopSelf()
    }

    override fun onDestroy() {
        stopTunnel()
        forwarder.shutdownNow()
        super.onDestroy()
    }

    private fun startTunnel() {
        if (isRunning) return

        Blocklist.ensureLoaded(this)
        loadAllowlist()
        upstreams = Settings.upstreamServers(this).mapNotNull {
            runCatching { InetAddress.getByName(it) }.getOrNull()
        }

        val pfd = Builder()
            .setSession(getString(R.string.app_name))
            .addAddress(VPN_ADDRESS, 32)
            .addDnsServer(FAKE_DNS)
            .addRoute(FAKE_DNS, 32)
            .setMtu(1500)
            .setBlocking(true)
            .establish()

        if (pfd == null) {
            // establish() returns null when VPN consent has been revoked.
            Log.w(TAG, "VPN not authorised; stopping")
            stopSelf()
            return
        }

        tunnel = pfd
        tunnelOut = FileOutputStream(pfd.fileDescriptor)
        blockedCount.set(0)
        forwardedCount.set(0)
        isRunning = true

        reader = Thread({ readLoop(FileInputStream(pfd.fileDescriptor)) }, "dns-tunnel").also { it.start() }

        if (Blocklist.isStale(this)) {
            Thread {
                try {
                    Blocklist.update(applicationContext)
                } catch (e: Exception) {
                    Log.w(TAG, "Automatic blocklist update failed", e)
                }
            }.start()
        }
    }

    private fun readLoop(input: FileInputStream) {
        val buf = ByteArray(32767)
        try {
            while (isRunning) {
                val n = input.read(buf)
                if (n <= 0) break

                // parseIpv4Udp copies what it keeps, so reusing buf is safe.
                val dgram = DnsCodec.parseIpv4Udp(buf, n) ?: continue
                if (dgram.dstPort != DnsCodec.DNS_PORT || !dgram.dstIp.contentEquals(fakeDnsBytes)) continue
                val query = DnsCodec.parseQuery(dgram.payload) ?: continue

                when {
                    BlocklistParser.isListed(query.name, allowlist) -> forward(dgram, query)
                    BlocklistParser.isListed(query.name, Blocklist.domains) -> {
                        blockedCount.incrementAndGet()
                        reply(
                            dgram,
                            DnsCodec.buildDnsError(dgram.payload, query.questionEnd, DnsCodec.RCODE_NXDOMAIN),
                        )
                    }
                    else -> forward(dgram, query)
                }
            }
        } catch (e: IOException) {
            if (isRunning) Log.w(TAG, "Tunnel read failed", e)
        }
        if (isRunning) {
            // The tunnel died without being asked to stop. Shut down cleanly.
            stopTunnel()
            stopSelf()
        }
    }

    private fun forward(req: DnsCodec.UdpDatagram, query: DnsCodec.DnsQuery) {
        forwardedCount.incrementAndGet()
        forwarder.execute {
            val answer = queryUpstream(req.payload)
                ?: DnsCodec.buildDnsError(req.payload, query.questionEnd, DnsCodec.RCODE_SERVFAIL)
            reply(req, answer)
        }
    }

    /** Sends the query to each upstream in turn. Returns the first answer, or null if none responded. */
    private fun queryUpstream(query: ByteArray): ByteArray? {
        for (server in upstreams) {
            try {
                DatagramSocket().use { socket ->
                    // Without protect(), this socket would route back into the tunnel and loop.
                    if (!protect(socket)) throw IOException("protect() failed")
                    socket.soTimeout = UPSTREAM_TIMEOUT_MS
                    socket.connect(InetSocketAddress(server, DnsCodec.DNS_PORT))
                    socket.send(DatagramPacket(query, query.size))
                    val buf = ByteArray(4096)
                    val resp = DatagramPacket(buf, buf.size)
                    socket.receive(resp)
                    return buf.copyOf(resp.length)
                }
            } catch (e: IOException) {
                Log.d(TAG, "Upstream $server failed: ${e.message}")
            }
        }
        return null
    }

    /** Writes a DNS answer back into the tunnel, addressed to the device that asked. */
    private fun reply(req: DnsCodec.UdpDatagram, dns: ByteArray) {
        val packet = DnsCodec.buildIpv4Udp(req.dstIp, req.srcIp, req.dstPort, req.srcPort, dns)
        synchronized(writeLock) {
            try {
                tunnelOut?.write(packet)
            } catch (e: IOException) {
                Log.w(TAG, "Write to tunnel failed", e)
            }
        }
    }

    private fun stopTunnel() {
        isRunning = false
        synchronized(writeLock) { tunnelOut = null }
        try {
            tunnel?.close()
        } catch (e: IOException) {
            Log.w(TAG, "Closing tunnel failed", e)
        }
        tunnel = null
        reader = null
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    private fun loadAllowlist() {
        allowlist = Settings.allowlist(this)
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_running))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }
}
