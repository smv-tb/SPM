/**
 * Decides the real client IP for a request reaching server-wrapper.mjs.
 *
 * The wrapper is the only code that sees the TCP peer, so it is the trust
 * boundary: it overwrites X-Real-IP with the answer from here, and the app
 * (src/lib/client-ip.ts) believes X-Real-IP and nothing else. A client that
 * sends its own X-Real-IP or X-Forwarded-For can no longer pick its rate-limit
 * bucket or the IP written to the audit log.
 *
 * X-Forwarded-For is only read when the peer is one of TRUSTED_PROXY_IPS (the
 * reverse proxy). Hops are walked from the right, skipping trusted proxies,
 * because each proxy appends the address it saw; everything left of the first
 * untrusted hop was written by the client and is ignored.
 *
 * Plain .mjs with no imports so the runner image can copy it as-is.
 */

/** "::ffff:192.168.1.10" → "192.168.1.10"; trims whitespace. */
export function normaliseIp(address) {
  const ip = String(address ?? "").trim();
  return ip.toLowerCase().startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip;
}

/** Parses the TRUSTED_PROXY_IPS env value (comma-separated) into a set. */
export function parseTrustedProxies(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map(normaliseIp)
      .filter(Boolean)
  );
}

/**
 * @param {string | undefined} peer           the TCP remote address
 * @param {string | string[] | undefined} xff the X-Forwarded-For header(s)
 * @param {Set<string>} trusted               from parseTrustedProxies
 */
export function resolveClientIp(peer, xff, trusted) {
  const peerIp = normaliseIp(peer);
  if (!trusted.has(peerIp)) return peerIp;

  const hops = (Array.isArray(xff) ? xff.join(",") : String(xff ?? ""))
    .split(",")
    .map(normaliseIp)
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!trusted.has(hops[i])) return hops[i];
  }
  // Only proxies in the chain (or no header): the proxy itself is the client.
  return hops[0] ?? peerIp;
}
