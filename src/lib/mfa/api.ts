import { logError } from "@/lib/log";
import { NextResponse } from "next/server";
import { auth, authIncludingPendingSetup } from "@/lib/auth";
import { actorFromSession, requestIp } from "@/lib/audit";
import { MfaError } from "@/lib/mfa/service";
import { CryptoConfigError } from "@/lib/crypto";

/** Secrets and recovery codes must never be cached by the browser or a proxy. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** The signed-in user's id plus what the service needs to audit their action. */
export async function requireAccount(req: Request, options: { allowPendingMfaSetup?: boolean } = {}) {
  // Setting up two-factor is the one thing a user whose role requires it may
  // do before they have it — but not while they still hold a temporary password.
  const session = options.allowPendingMfaSetup ? await authIncludingPendingSetup() : await auth();
  const flags = session?.user as { id?: string; sid?: string; mustChangePassword?: boolean } | undefined;
  const id = flags?.mustChangePassword ? undefined : flags?.id;
  if (!session || !id) return { ok: false as const, response: json({ error: "Unauthorized" }, 401) };
  return {
    ok: true as const,
    userId: id,
    sessionId: flags?.sid,
    email: (session.user as { email?: string }).email ?? "",
    audit: { actor: actorFromSession(session), ipAddress: requestIp(req) },
  };
}

const STATUS: Record<string, number> = {
  NOT_FOUND: 404, ALREADY_ENABLED: 409, NOT_ENROLLING: 409, NOT_ENABLED: 409, INVALID_CODE: 400,
};

/** Turns the service's errors into responses; anything else is left for withErrorHandler. */
export function mfaError(error: unknown) {
  if (error instanceof MfaError) return json({ error: error.message, code: error.code }, STATUS[error.code] ?? 400);
  if (error instanceof CryptoConfigError) {
    logError("mfa", "unavailable: no encryption key set up", error);
    return json({ error: "Two-factor sign-in isn't available: the server has no encryption key set up." }, 503);
  }
  throw error;
}
