import { logError } from "@/lib/log";
import type { Prisma } from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";

/**
 * Audit rows for sign-in events. The audit table is append-only, so anything an
 * outsider can trigger could grow it without limit; the rule is therefore to
 * record only what is already bounded:
 *
 * - failures for **real accounts** only (an attacker can invent unlimited
 *   emails, but each real account locks after a handful of failures), and
 * - never an attempt that was refused because the account was already locked.
 *
 * Failing to write an audit row must never break signing in (or out), so
 * errors are logged and swallowed.
 */
export type AuthEvent =
  | "auth.login"          // signed in
  | "auth.login_failed"   // wrong password for a real account
  | "auth.mfa_failed"     // right password, wrong second-step code
  | "auth.lockout";       // the account (or its second step) just locked

export interface RequestFacts {
  ipAddress: string | null;
  userAgent: string | null;
}

const MAX_USER_AGENT = 200;

export function requestFacts(headers: Headers): RequestFacts {
  const ua = headers.get("user-agent")?.trim();
  return { ipAddress: clientIp(headers), userAgent: ua ? ua.slice(0, MAX_USER_AGENT) : null };
}

type Db = Pick<Prisma.TransactionClient, "auditLog">;

export async function auditAuthEvent(
  db: Db,
  event: AuthEvent,
  user: { id: string; email: string },
  request: RequestFacts,
  details: Record<string, string | number | boolean> = {}
): Promise<void> {
  // A success is the user's own act; a failure happened *to* the account, by someone unknown.
  const actor: AuditActor =
    event === "auth.login"
      ? { type: "USER", id: user.id, label: user.email }
      : { type: "SYSTEM", label: "sign-in" };
  try {
    await recordAudit(db, {
      actor,
      action: event,
      entityType: "User",
      entityId: user.id,
      after: { ...details, ...(request.userAgent ? { userAgent: request.userAgent } : {}) },
      ipAddress: request.ipAddress,
    });
  } catch (error) {
    logError("auth-audit", `could not audit ${event}`, error);
  }
}
