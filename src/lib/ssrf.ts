const PRIVATE_IP_PATTERNS = [
  // IPv4 private ranges
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  // IPv6 loopback / link-local / unique-local (bare hostname — new URL() strips brackets)
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
  // IPv6-mapped IPv4 private addresses (new URL hostname strips brackets)
  /^::ffff:127\./,
  /^::ffff:10\./,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^::ffff:192\.168\./,
  /^::ffff:0\./,
  /^::ffff:169\.254\./,
  // Bracket-form variants (fallback if hostname isn't stripped)
  /^\[::1\]$/,
  /^\[fc00:/,
  /^\[fe80:/,
  /^\[::ffff:127\./,
  /^\[::ffff:10\./,
  /^\[::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^\[::ffff:192\.168\./,
  /^\[::ffff:0\./,
  /^\[::ffff:169\.254\./,
];

/**
 * Validates that a URL does not point to a private/internal IP address
 * to prevent Server-Side Request Forgery (SSRF) attacks.
 * Returns true if the URL is private (unsafe), false if it's safe.
 */
export function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname;
    if (hostname === "localhost" || hostname === "0.0.0.0") return true;
    return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return true; // reject invalid URLs
  }
}
