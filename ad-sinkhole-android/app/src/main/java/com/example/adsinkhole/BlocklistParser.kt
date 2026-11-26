package com.example.adsinkhole

/**
 * Turns lines from common blocklist formats into bare domains.
 *
 * Supported: hosts files ("0.0.0.0 ads.example.com"), plain domain lists,
 * and simple AdBlock domain rules ("||ads.example.com^"). Anything with
 * modifiers, cosmetic rules or exception rules is skipped.
 */
object BlocklistParser {
    private val adblockRule = Regex("""\|\|([a-z0-9._-]+)\^""")
    private val domainPattern = Regex("""([a-z0-9_-]+\.)+[a-z0-9-]{2,63}""")
    private val hostsAddresses = setOf("0.0.0.0", "127.0.0.1", "::", "::1", "0:0:0:0:0:0:0:0", "0:0:0:0:0:0:0:1")
    private val whitespace = Regex("""\s+""")
    private val reservedNames = setOf(
        "localhost", "localhost.localdomain", "local", "broadcasthost",
        "ip6-localhost", "ip6-loopback",
    )

    /** Returns the blocked domain for one list line, or null if the line does not block a domain. */
    fun parseLine(rawLine: String): String? {
        val line = rawLine.trim().lowercase()
        if (line.isEmpty() || line.startsWith("!") || line.startsWith("#")) return null
        // Cosmetic (element hiding) and scriptlet rules are not domains.
        if (line.contains("##") || line.contains("#@#") || line.contains("#?#") || line.contains("#$#")) return null

        val tokens = line.split(whitespace)
        val candidate = when {
            tokens.size == 1 -> adblockRule.matchEntire(line)?.groupValues?.get(1) ?: line
            tokens.size >= 2 && tokens[0] in hostsAddresses -> tokens[1]
            else -> null
        } ?: return null

        val domain = candidate.trimEnd('.')
        if (domain in reservedNames || !domainPattern.matches(domain)) return null
        return domain
    }

    /** Normalises one allowlist entry ("*.Example.com." -> "example.com"), or null if it is not a domain. */
    fun normalizeAllowEntry(raw: String): String? {
        val domain = raw.trim().lowercase().removePrefix("*.").trimEnd('.')
        return domain.takeIf { domainPattern.matches(it) }
    }

    /** True if [name] or any parent domain of it (a.b.example.com -> b.example.com -> example.com) is in [domains]. */
    fun isListed(name: String, domains: Set<String>): Boolean {
        var current = name
        while (current.isNotEmpty()) {
            if (current in domains) return true
            val dot = current.indexOf('.')
            if (dot < 0) break
            current = current.substring(dot + 1)
        }
        return false
    }
}
