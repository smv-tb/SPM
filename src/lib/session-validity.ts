import { randomUUID } from "node:crypto";

/**
 * Whether a session token may still be used, decided from the user's current
 * row. Kept free of Prisma and NextAuth so the rules can be unit-tested.
 *
 * The token carries the user's `securityStamp` from sign-in. Changing a user's
 * role, active flag or password rotates the stamp (see `newSecurityStamp`), so
 * every session issued before the change stops working on its next request —
 * not whenever the token happens to be re-checked.
 */
export interface SessionUserRow {
  role: string;
  isActive: boolean;
  securityStamp: string;
}

export function sessionStillValid(tokenStamp: unknown, user: SessionUserRow | null): user is SessionUserRow {
  if (!user || !user.isActive) return false;
  // A token with no stamp predates this check; it can't prove it is current.
  if (typeof tokenStamp !== "string" || tokenStamp === "") return false;
  return tokenStamp === user.securityStamp;
}

/** A fresh stamp; assign it in the same update that changes role, active flag or password. */
export function newSecurityStamp(): string {
  return randomUUID();
}

/** Whether an update to a user must end that user's existing sessions. */
export function changeEndsSessions(
  before: { role: string; isActive: boolean },
  change: { role?: string; isActive?: boolean; password?: string | null }
): boolean {
  if (change.password) return true;
  if (change.role !== undefined && change.role !== before.role) return true;
  if (change.isActive !== undefined && change.isActive !== before.isActive) return true;
  return false;
}

/**
 * Whether setting a password for `targetId` hands them one they did not choose.
 * An admin resetting their own password knows it; anyone else's is temporary.
 */
export function resetRequiresChange(actorId: string | undefined, targetId: string): boolean {
  return actorId !== targetId;
}
