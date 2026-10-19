import { logError, logWarn } from "@/lib/log";
import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuditActor } from "@/lib/audit";

/**
 * Security alerts (S5.2). The audit log records what happened; this tells an
 * administrator *now* about the handful of events where minutes matter — a new
 * admin, a second factor switched off, a closed period re-opened, bank details
 * changed, an account locked by guessing, an admin signing in from somewhere new.
 *
 * Delivery is one signed JSON POST to `SECURITY_ALERT_WEBHOOK_URL` (an n8n
 * webhook that fans out to email, chat, whatever). The URL is operator
 * configuration from the environment, not user input, so it may be a private
 * address (n8n usually is) and is deliberately not run through the SSRF guard.
 *
 * Rules that must hold:
 * - **Call it after the change has committed**, never inside the transaction: an
 *   alert for something that rolled back is a false alarm.
 * - **It never throws and never waits long.** A dead webhook must not break
 *   sign-in or block a save; it is fire-and-forget with a short timeout.
 * - **No secrets in the payload** — no passwords, hashes, codes or tokens.
 */
export type SecurityEvent =
  | "user.admin_granted"   // a new admin, or an existing user made admin
  | "mfa.reset"            // an administrator switched off someone's second factor
  | "bank.details_changed" // company or bank-account details that appear on invoices
  | "books.reopened"       // a locked period was re-opened
  | "api_token.created"    // reserved for S4
  | "auth.lockout"         // an account locked after repeated failures
  | "auth.admin_new_ip";   // an admin signed in from an address never seen before

export type Severity = "info" | "warning" | "critical";

export interface SecurityAlert {
  event: SecurityEvent;
  /** One plain sentence a person can act on without opening the app. */
  summary: string;
  /** Who did it (an email, `HERMES`, or `system`). */
  actor?: string | null;
  /** Who or what it happened to. */
  target?: string | null;
  ipAddress?: string | null;
  details?: Record<string, string | number | boolean | null>;
}

const SEVERITY: Record<SecurityEvent, Severity> = {
  "user.admin_granted": "warning",
  "mfa.reset": "critical",
  "bank.details_changed": "critical",
  "books.reopened": "warning",
  "api_token.created": "warning",
  "auth.lockout": "warning",
  "auth.admin_new_ip": "warning",
};

export const SIGNATURE_HEADER = "x-smartvie-signature";
const TIMEOUT_MS = 5000;

export interface AlertPayload extends SecurityAlert {
  source: "smartvie-pm";
  severity: Severity;
  occurredAt: string;
}

export function buildPayload(alert: SecurityAlert, now = new Date()): AlertPayload {
  return {
    source: "smartvie-pm",
    severity: SEVERITY[alert.event],
    occurredAt: now.toISOString(),
    ...alert,
  };
}

/** `sha256=<hex>` over the exact body bytes, so the receiver can verify it came from us. */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Sends the alert and resolves either way; failures are logged, never thrown. */
export async function notifySecurityEvent(alert: SecurityAlert): Promise<void> {
  const url = process.env.SECURITY_ALERT_WEBHOOK_URL?.trim();
  const payload = buildPayload(alert);
  if (!url) {
    // Not configured is a legitimate state (development); leave a trace so it isn't silent.
    logWarn("security-alert", `${payload.event}: ${payload.summary} (no SECURITY_ALERT_WEBHOOK_URL set)`);
    return;
  }
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    const secret = process.env.SECURITY_ALERT_WEBHOOK_SECRET?.trim();
    if (secret) headers[SIGNATURE_HEADER] = signBody(body, secret);
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) logError("security-alert", `webhook answered ${res.status} for ${payload.event}`);
  } catch (error) {
    logError("security-alert", `could not deliver ${payload.event}`, error);
  }
}

/** Same, without making the caller wait. Use this from request paths. */
export function alertInBackground(alert: SecurityAlert): void {
  void notifySecurityEvent(alert);
}

/**
 * Has this admin signed in from this address before? Only a *previous* sign-in
 * counts, so call it before recording the current one. With no history at all
 * (a first sign-in) nothing is "new" — the new-admin alert already covered that.
 */
export async function isNewSignInAddress(
  db: Pick<Prisma.TransactionClient, "auditLog">,
  userId: string,
  ipAddress: string | null
): Promise<boolean> {
  if (!ipAddress) return false;
  const base = { action: "auth.login", entityType: "User", entityId: userId };
  const [any, here] = await Promise.all([
    db.auditLog.count({ where: base, take: 1 }),
    db.auditLog.count({ where: { ...base, ipAddress } }),
  ]);
  return any > 0 && here === 0;
}

/** Whether an update turned someone into an admin (a new admin counts as a change from nothing). */
export const becameAdmin = (before: string | null | undefined, after: string): boolean =>
  after === "ADMIN" && before !== "ADMIN";

/** The actor as a short string for an alert: the user's email, `HERMES`, or the system label. */
export const actorLabel = (actor: AuditActor): string | null =>
  actor.type === "HERMES" ? "HERMES" : actor.label;
