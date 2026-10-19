/**
 * The client's IP, for rate limiting and the audit log.
 *
 * In production server-wrapper.mjs sits in front of Next, sees the TCP peer
 * and always overwrites X-Real-IP (trusting X-Forwarded-For only from
 * TRUSTED_PROXY_IPS — see trusted-proxy.mjs), so X-Real-IP is the answer and
 * a client cannot choose it. Without the wrapper (`yarn dev`, `next start`)
 * nothing is trustworthy and the rightmost X-Forwarded-For hop is a best guess.
 *
 * Edge-safe: used by src/proxy.ts as well as route handlers.
 */
export function clientIp(headers: Headers): string | null {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return headers.get("x-forwarded-for")?.split(",").pop()?.trim() || null;
}
