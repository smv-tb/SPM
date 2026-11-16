/**
 * The client's IP, for rate limiting and the audit log.
 *
 * In production server-wrapper.mjs sits in front of Next, sees the TCP peer
 * and always overwrites X-Real-IP (trusting X-Forwarded-For only from
 * TRUSTED_PROXY_IPS — see trusted-proxy.mjs), so X-Real-IP is the answer and
 * a client cannot choose it.
 *
 * Nothing in a header proves the wrapper was there, so the wrapper also stamps
 * every request with a per-boot token (WRAPPER_MARKER_HEADER) that it hands to
 * the Next process through WRAPPER_TOKEN_ENV. X-Real-IP is believed only on a
 * request carrying that token: a request that reached Next another way (the
 * inner port published by mistake) gets null, never an address it chose.
 *
 * Without the wrapper there is no token. Production refuses to start then
 * (`wrapperStartupProblem`, called from src/instrumentation.ts); in development
 * (`next dev`) the rightmost X-Forwarded-For hop is a best guess, which the
 * login-throttling checks rely on to stand in for several clients.
 *
 * Edge-safe (no node: imports): used by src/proxy.ts as well as route handlers.
 */
export const WRAPPER_MARKER_HEADER = "x-smartvie-wrapper";
export const WRAPPER_TOKEN_ENV = "SMARTVIE_WRAPPER_TOKEN";

/** Constant-time string compare, without node:crypto so it stays edge-safe. */
function sameToken(given: string | null, expected: string): boolean {
  if (given === null || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function clientIp(
  headers: Headers,
  env: { token?: string; nodeEnv?: string } = {
    token: process.env[WRAPPER_TOKEN_ENV],
    nodeEnv: process.env.NODE_ENV,
  }
): string | null {
  if (env.token) {
    if (!sameToken(headers.get(WRAPPER_MARKER_HEADER), env.token)) return null;
    return headers.get("x-real-ip")?.trim() || null;
  }
  // No wrapper. Production does not start like this; if it somehow runs, trust nothing.
  if (env.nodeEnv === "production") return null;
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return headers.get("x-forwarded-for")?.split(",").pop()?.trim() || null;
}

/**
 * What to do at server start: null when the wrapper is in front, a warning in
 * development, a refusal in production (rate limits, audit IPs and new-address
 * alerts would all be meaningless).
 */
export function wrapperStartupProblem(env: {
  token?: string;
  nodeEnv?: string;
}): { level: "warn" | "refuse"; message: string } | null {
  if (env.token) return null;
  if (env.nodeEnv === "production") {
    return {
      level: "refuse",
      message:
        "Refusing to start: not running behind server-wrapper.mjs. Rate limits, audit IPs and " +
        "new-address alerts depend on it overwriting X-Real-IP. Start with `node server-wrapper.mjs`.",
    };
  }
  return {
    level: "warn",
    message:
      "Running without server-wrapper.mjs: the client IP is a best guess from request headers " +
      "and can be chosen by the client. Fine for development, never for production.",
  };
}
