# Ad Sinkhole

A system-wide ad blocker for Android, with no root required. It works the way
AdAway and Pi-hole's DNS mode work: a local VPN slot intercepts DNS lookups,
returns "no such domain" for ad and tracker hosts, and forwards everything else
to a normal resolver.

## How it works

```
app wants ads.example.com
        │  DNS query to 10.111.222.1 (fake resolver, set by the VPN)
        ▼
 ┌────────────────────────────┐
 │ AdBlockVpnService (TUN)    │
 │  • blocked?  → NXDOMAIN    │  ← blocklist lookup, suffix-aware
 │  • otherwise → forward to  │  ← protect()ed socket, 1.1.1.1 / 8.8.8.8
 │    upstream and relay reply│
 └────────────────────────────┘
```

- Only the fake DNS address is routed into the tunnel. Normal traffic
  (HTTP, HTTPS, games, streaming) never goes through the VPN, so it is not
  slowed down or inspected.
- A domain on the list also blocks its subdomains. For example, `ads.example.com`
  is blocked when `example.com` is listed.
- Blocking uses four public lists merged together (about 526,000 unique
  domains): AdGuard DNS filter, StevenBlack unified hosts, HaGeZi Multi PRO
  and OISD Big. The merged list is cached on the device.
- **Auto-update** (on by default) refreshes the lists every 7 days using
  WorkManager. It waits for a network connection and survives reboots. Turn it
  off with the switch in the app. Manual updates still work either way.
- Allowlist entries are never blocked, including their subdomains.

## Build

Requirements: JDK 17 or newer and the Android SDK (platform 35, build-tools 35).

```bash
echo "sdk.dir=/path/to/Android/Sdk" > local.properties   # or set ANDROID_HOME
./gradlew testDebugUnitTest assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Open the folder in Android Studio and press Run to install on a device.

## Using it

1. Open **Ad Sinkhole** and tap **Update lists**. The lists also download on
   first start, and the 7-day auto-update keeps them current after that.
2. Tap **Start protection** and accept the VPN prompt. A key icon appears in the
   status bar while the VPN is active.
3. Add domains that break sites to the allowlist and tap **Save allowlist**.

## Limitations (please read)

This is DNS-level blocking. It catches most ads, trackers and telemetry, but
it cannot do everything a full filter such as AdGuard's own app can do:

- **Browsers and apps that use their own encrypted DNS bypass it.** Chrome
  "Secure DNS" and Firefox DoH send lookups straight to the resolver. Turn these
  off so they use the system resolver.
- **Android Private DNS bypasses it.** Set Settings → Network → Private DNS
  to *Off*. Other values such as "dns.google" send lookups over TLS past the
  tunnel.
- **Ads served from the same domain as content are not blocked.** YouTube
  video ads and in-app ads that share a domain with the app's own content
  cannot be separated by DNS alone.
- **IPv6-only DNS is not intercepted.** Only the IPv4 resolver address is
  handed to the system.
- **Not verified on a physical device in this repository.** Packet handling is
  covered by JVM unit tests, and the app builds and passes lint. Test on your
  own phone before relying on it.
- Only one VPN can be active at a time, so turning this on disables any other
  VPN app.

## Project layout

```
app/src/main/java/com/example/adsinkhole/
  AdBlockVpnService.kt  VPN tunnel: reads DNS packets, blocks or forwards, writes replies
  DnsCodec.kt           Pure IPv4/UDP/DNS packet parsing and building
  BlocklistParser.kt    hosts / domain / AdBlock-rule parsing, suffix matching
  Blocklist.kt          Downloads, stores and serves the blocked-domain set
  Settings.kt           SharedPreferences: allowlist, upstream DNS, update time
  MainActivity.kt       Start/stop, stats, list update, allowlist editor
app/src/test/           JVM unit tests for the codec and parser
```

The upstream resolvers are set in `Settings.upstreamServers` (default
`1.1.1.1,8.8.8.8`). The block-list sources are in `Blocklist.SOURCES`. The
7-day schedule lives in `AutoUpdate.kt`.
