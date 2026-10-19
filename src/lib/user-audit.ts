import type { Prisma } from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";

/**
 * Audit trail for who has access. Every create, delete and access-changing edit
 * of a user — from the web routes **and** the Hermes agent — writes rows here
 * inside the same transaction as the change, so the log can't claim something
 * that rolled back or miss something that committed.
 *
 * One row per kind of change, with its own action name, so they can be searched
 * and alerted on separately (`user.role_change`, `user.deactivate`, …). The
 * password is never recorded — not the new one, not the hash — only that it was
 * reset.
 */
export interface UserSnapshot {
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
}

export const userSnapshot = (u: UserSnapshot): UserSnapshot => ({
  email: u.email,
  name: u.name,
  role: u.role,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
});

export interface UserEvent {
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** What an update did, as separate events. Empty when nothing audit-worthy changed. */
export function userChangeEvents(
  before: UserSnapshot,
  after: UserSnapshot,
  options: { passwordReset: boolean }
): UserEvent[] {
  const events: UserEvent[] = [];

  if (before.role !== after.role) {
    events.push({ action: "user.role_change", before: { role: before.role }, after: { role: after.role } });
  }
  if (before.isActive !== after.isActive) {
    events.push({
      action: after.isActive ? "user.activate" : "user.deactivate",
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    });
  }
  if (options.passwordReset) {
    // Only that it happened, and whether the person now has to replace it. Recorded as an
    // `after` alone: with a `before` the log keeps just the fields that changed, and a reset of
    // someone who already had to change their password would otherwise store nothing at all.
    events.push({ action: "user.password_reset", after: { mustChangePassword: after.mustChangePassword } });
  }
  if (before.name !== after.name || before.email !== after.email) {
    events.push({
      action: "user.update",
      before: { name: before.name, email: before.email },
      after: { name: after.name, email: after.email },
    });
  }
  return events;
}

type Tx = Pick<Prisma.TransactionClient, "auditLog">;
interface Where { actor: AuditActor; ipAddress?: string | null }

export async function recordUserCreated(tx: Tx, where: Where, userId: string, user: UserSnapshot) {
  await recordAudit(tx, {
    ...where, action: "user.create", entityType: "User", entityId: userId, after: userSnapshot(user),
  });
}

export async function recordUserChanged(
  tx: Tx, where: Where, userId: string, before: UserSnapshot, after: UserSnapshot, options: { passwordReset: boolean }
) {
  for (const event of userChangeEvents(before, after, options)) {
    await recordAudit(tx, { ...where, entityType: "User", entityId: userId, ...event });
  }
}

/** A full snapshot of who was removed, since the row itself is gone. */
export async function recordUserDeleted(tx: Tx, where: Where, userId: string, user: UserSnapshot) {
  await recordAudit(tx, {
    ...where, action: "user.delete", entityType: "User", entityId: userId, before: userSnapshot(user),
  });
}
