import { createHash, timingSafeEqual } from "node:crypto";
import { logWarn } from "@/lib/log";

export function verifyToken(token: string | undefined | null): boolean {
  const expected = process.env.HERMES_API_TOKEN;
  if (!expected) {
    logWarn("hermes", "HERMES_API_TOKEN not set — all requests will be rejected");
    return false;
  }
  if (!token) return false;
  // `===` returns as soon as a character differs, so response timing leaks how
  // much of a guess was right. Hashing first gives equal-length inputs, which
  // timingSafeEqual requires, without leaking the real token's length.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(token), digest(expected));
}

export function withHermesAuth(
  token: string | undefined | null
): { ok: true } | { ok: false; error: string } {
  if (!verifyToken(token)) {
    return { ok: false, error: "Unauthorized: invalid or missing HERMES_API_TOKEN" };
  }
  return { ok: true };
}

/** Parses a bearer token out of a request's Authorization header, if present. */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}
