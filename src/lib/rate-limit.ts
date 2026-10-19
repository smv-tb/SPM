/**
 * Fixed-window, in-memory rate limiter (per process). Pure apart from the
 * clock, which callers can pass in for tests.
 */
export interface RateLimitDecision {
  limited: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms at which the current window ends. */
  resetAt: number;
  /** Seconds until the window ends — the honest Retry-After, not the full window. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  check(key: string, now?: number): RateLimitDecision;
  prune(now?: number): void;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const store = new Map<string, { count: number; resetAt: number }>();

  const decision = (count: number, resetAt: number, now: number, limited: boolean): RateLimitDecision => ({
    limited,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  });

  return {
    limit,
    windowMs,
    check(key, now = Date.now()) {
      const entry = store.get(key);
      if (!entry || now >= entry.resetAt) {
        const fresh = { count: 1, resetAt: now + windowMs };
        store.set(key, fresh);
        return decision(fresh.count, fresh.resetAt, now, false);
      }
      if (entry.count >= limit) return decision(entry.count, entry.resetAt, now, true);
      entry.count++;
      return decision(entry.count, entry.resetAt, now, false);
    },
    prune(now = Date.now()) {
      for (const [key, entry] of store) if (now >= entry.resetAt) store.delete(key);
    },
  };
}

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Browser/API traffic: per client IP. */
export const API_RATE_LIMIT = {
  max: envInt("API_RATE_LIMIT_MAX_REQUESTS", 100),
  windowMs: envInt("API_RATE_LIMIT_WINDOW_MS", 60_000),
};

/**
 * Hermes MCP traffic (`/api/hermes`): its own bucket, so web-UI traffic from
 * the same address cannot starve the agent mid-batch (and vice versa). Every
 * HTTP request counts — one tool call is one POST — so a bulk tool is one
 * request however many rows it touches.
 */
export const HERMES_RATE_LIMIT = {
  max: envInt("HERMES_RATE_LIMIT_MAX_REQUESTS", 300),
  windowMs: envInt("HERMES_RATE_LIMIT_WINDOW_MS", 60_000),
};
