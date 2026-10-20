/**
 * Content Security Policy with a per-request nonce (S5.1).
 *
 * Today's enforced policy (next.config.mjs) allows `'unsafe-inline'` and
 * `'unsafe-eval'` scripts, which defeats most of what a CSP is for. This is the
 * stricter policy that replaces it: scripts run only if they carry the nonce
 * the proxy minted for that response (`'strict-dynamic'` lets those scripts
 * load their own chunks). It ships as `Content-Security-Policy-Report-Only`
 * first, with violations posted to `/api/csp-report`, and is switched to
 * enforcing once a week of reports comes back clean.
 *
 * Styles keep `'unsafe-inline'`: a nonce cannot cover `style=""` attributes,
 * which React, Radix and Recharts all emit, and inline style is far less
 * dangerous than inline script.
 *
 * Dependency-free so it can be unit-tested directly.
 */

export const CSP_REPORT_PATH = "/api/csp-report";

/** 128 random bits, base64. Works in the proxy's runtime (Web Crypto, no Buffer needed). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildCsp(nonce: string, opts: { dev?: boolean } = {}): string {
  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  // The dev server evaluates code for hot reload and React's error overlay.
  if (opts.dev) script.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    opts.dev ? "connect-src 'self' http://localhost:* ws://localhost:*" : "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}
