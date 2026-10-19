import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  API_RATE_LIMIT, HERMES_RATE_LIMIT, createRateLimiter, type RateLimitDecision,
} from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Proxy for CSRF protection and API rate limiting.
 *
 * CSRF:
 * - Excludes /api/auth/* and /api/health from checks
 * - For mutation methods (POST, PUT, PATCH, DELETE) on API routes:
 *   validates X-Requested-By header is present (minimum check)
 * - For GET requests to API routes: validates Origin/Referer against
 *   NEXTAUTH_URL (anti-clickjacking for API)
 *
 * Rate limiting:
 * - Per-IP in-memory rate limiting for non-auth API calls
 * - /api/hermes has its own per-IP bucket (HERMES_RATE_LIMIT_*), so the web
 *   UI and the agent cannot exhaust each other's allowance
 * - Configurable limit and window via env vars
 */

// ---------------------------------------------------------------------------
// In-memory rate limiting (see src/lib/rate-limit.ts for the documented limits)
// ---------------------------------------------------------------------------
const apiLimiter = createRateLimiter(API_RATE_LIMIT.max, API_RATE_LIMIT.windowMs);
const hermesLimiter = createRateLimiter(HERMES_RATE_LIMIT.max, HERMES_RATE_LIMIT.windowMs);

function getClientIp(request: NextRequest): string {
  return clientIp(request.headers) ?? "unknown";
}

// Periodically clean up stale entries (every 5 minutes)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    apiLimiter.prune();
    hermesLimiter.prune();
  }, 5 * 60 * 1000);
}

function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(d.limit),
    "X-RateLimit-Remaining": String(d.remaining),
    "X-RateLimit-Reset": String(Math.ceil(d.resetAt / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip processing for static files, Next.js internals, and NextAuth routes
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // --- Rate limiting for all non-auth API calls ---
  let hermesDecision: RateLimitDecision | null = null;
  if (pathname.startsWith("/api/hermes")) {
    hermesDecision = hermesLimiter.check(getClientIp(request));
    if (hermesDecision.limited) {
      // JSON-RPC shaped, so an MCP client surfaces the reason instead of a
      // generic transport failure, and says exactly when to retry.
      return new NextResponse(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32029,
            message: `Rate limit exceeded: ${hermesDecision.limit} requests per ${HERMES_RATE_LIMIT.windowMs / 1000}s. Retry in ${hermesDecision.retryAfterSeconds}s.`,
            data: {
              limit: hermesDecision.limit,
              windowSeconds: HERMES_RATE_LIMIT.windowMs / 1000,
              retryAfterSeconds: hermesDecision.retryAfterSeconds,
            },
          },
          id: null,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(hermesDecision.retryAfterSeconds),
            ...rateLimitHeaders(hermesDecision),
          },
        }
      );
    }
  } else if (pathname.startsWith("/api/")) {
    const decision = apiLimiter.check(getClientIp(request));
    if (decision.limited) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(decision.retryAfterSeconds),
          },
        }
      );
    }
  }

  // --- CSRF protection for API routes ---
  // /api/hermes is exempt: it's authenticated with a bearer token (checked in
  // the route itself), not ambient cookies/sessions, so it isn't a CSRF
  // target — a malicious page can't forge an Authorization header it doesn't
  // have. It still goes through rate limiting above.
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/hermes")) {
    const method = request.method;

    // Mutation methods: require X-Requested-By header
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const requestedBy = request.headers.get("X-Requested-By");
      if (!requestedBy) {
        return new NextResponse(
          JSON.stringify({ error: "CSRF validation failed: missing X-Requested-By header" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // GET/HEAD requests: validate Origin (anti-clickjacking for API)
    if (method === "GET" || method === "HEAD") {
      const origin = request.headers.get("origin");
      const referer = request.headers.get("referer");
      const source = origin || referer;

      // No Origin/Referer for GET is allowed (browser direct navigation, curl).
      if (source) {
        // Accept a request whose Origin host matches the host the app is being
        // served on. A same-origin request is by definition not CSRF, and this
        // is what the NEXTAUTH_URL comparison below was really trying to
        // express — but that comparison includes the scheme, so behind a
        // TLS-terminating reverse proxy (NEXTAUTH_URL=http://…, browser on
        // https://…) it rejected the app's own fetches with a 403. Every
        // client-side GET in the app failed that way, mostly silently.
        const requestHost =
          request.headers.get("x-forwarded-host") ?? request.headers.get("host");

        let allowedOrigin: string | null = null;
        try {
          allowedOrigin = process.env.NEXTAUTH_URL
            ? new URL(process.env.NEXTAUTH_URL).origin
            : null;
        } catch {
          // A malformed NEXTAUTH_URL must not take the whole API down; fall
          // back to the same-host check.
          allowedOrigin = null;
        }

        if (allowedOrigin || requestHost) {
          let sourceUrl: URL;
          try {
            sourceUrl = new URL(source);
          } catch {
            return new NextResponse(
              JSON.stringify({ error: "Invalid origin header" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const sameHost = requestHost != null && sourceUrl.host === requestHost;
          const matchesConfigured = allowedOrigin != null && sourceUrl.origin === allowedOrigin;

          if (!sameHost && !matchesConfigured) {
            return new NextResponse(
              JSON.stringify({ error: "Invalid origin" }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }
        }
      }
    }
  }

  const response = NextResponse.next();
  if (hermesDecision) {
    for (const [name, value] of Object.entries(rateLimitHeaders(hermesDecision))) response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    // Match all API routes
    "/api/:path*",
  ],
};