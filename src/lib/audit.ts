import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { clientIp } from "@/lib/client-ip";

/**
 * Audit trail for financial data.
 *
 * Every mutation of money-bearing rows writes one `AuditLog` row *inside the
 * same transaction* as the change, so the log can never claim something
 * happened that was rolled back, or miss something that committed. The table
 * is append-only at the database level (trigger in the migration).
 *
 * Only the pure helpers here are unit-tested; `recordAudit` is a thin insert.
 */

export type AuditActor =
  | { type: "USER"; id: string; label: string | null }
  | { type: "HERMES" }
  | { type: "SYSTEM"; label: string };

export const HERMES_ACTOR: AuditActor = { type: "HERMES" };

export function actorFromSession(session: Session): AuditActor {
  const user = session.user as { id?: unknown; email?: unknown } | undefined;
  if (typeof user?.id !== "string") {
    throw new Error("Cannot audit an action without an authenticated user id");
  }
  return { type: "USER", id: user.id, label: typeof user.email === "string" ? user.email : null };
}

/** The client IP recorded on audit rows; see src/lib/client-ip.ts. */
export function requestIp(req: Request): string | null {
  return clientIp(req.headers);
}

type AuditJson = string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };

function isDecimalLike(value: object): value is { toFixed(): string } {
  // decimal.js instances (Prisma.Decimal) carry sign/exponent/digits fields.
  return "s" in value && "e" in value && "d" in value && typeof (value as { toFixed?: unknown }).toFixed === "function";
}

/**
 * Converts a row into JSON that round-trips exactly: Decimals stay as their
 * exact string (never a lossy float), Dates become ISO strings.
 */
export function toAuditJson(value: unknown): AuditJson {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toAuditJson);
  if (typeof value === "object") {
    if (isDecimalLike(value)) return value.toFixed();
    const out: { [key: string]: AuditJson } = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || typeof v === "function") continue;
      out[key] = toAuditJson(v);
    }
    return out;
  }
  return null;
}

function isObject(value: AuditJson): value is { [key: string]: AuditJson } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * For updates, keep only the fields that changed — a full before/after copy of
 * every row on every save makes the log unreadable and large.
 */
export function diffForAudit(before: unknown, after: unknown): { before: AuditJson; after: AuditJson } {
  const b = toAuditJson(before);
  const a = toAuditJson(after);
  if (!isObject(b) || !isObject(a)) return { before: b, after: a };

  const changedBefore: { [key: string]: AuditJson } = {};
  const changedAfter: { [key: string]: AuditJson } = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key] ?? null) === JSON.stringify(a[key] ?? null)) continue;
    changedBefore[key] = b[key] ?? null;
    changedAfter[key] = a[key] ?? null;
  }
  return { before: changedBefore, after: changedAfter };
}

export interface AuditEntry {
  actor: AuditActor;
  /** Dotted verb, e.g. "funding.update". */
  action: string;
  entityType: string;
  entityId: string;
  /** Omit for creates. */
  before?: unknown;
  /** Omit for deletes. */
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
}

export function buildAuditRow(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  const { actor } = entry;
  const snapshot =
    entry.before != null && entry.after != null
      ? diffForAudit(entry.before, entry.after)
      : { before: toAuditJson(entry.before), after: toAuditJson(entry.after) };

  return {
    actorType: actor.type,
    actorId: actor.type === "USER" ? actor.id : null,
    actorLabel: actor.type === "USER" ? actor.label : actor.type === "SYSTEM" ? actor.label : "hermes",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    // Prisma rejects a bare `null` for a Json column; leaving the key out stores NULL.
    ...(snapshot.before !== null ? { before: snapshot.before as Prisma.InputJsonValue } : {}),
    ...(snapshot.after !== null ? { after: snapshot.after as Prisma.InputJsonValue } : {}),
    reason: entry.reason ?? null,
    ipAddress: entry.ipAddress ?? null,
  };
}

/** Call with the transaction client of the change being audited. */
export async function recordAudit(
  tx: Pick<Prisma.TransactionClient, "auditLog">,
  entry: AuditEntry
): Promise<void> {
  await tx.auditLog.create({ data: buildAuditRow(entry) });
}
