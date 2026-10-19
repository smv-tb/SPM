/**
 * Where a signed-in user who still owes something must go. Order matters: a
 * temporary password is replaced first, so the second factor is never set up
 * by someone still holding a password an administrator chose.
 */
export interface PendingFlags {
  mustChangePassword?: boolean;
  mfaSetupRequired?: boolean;
}

export type PendingPath = "/change-password" | "/setup-two-factor";

export function pendingSetupPath(user: PendingFlags | undefined | null): PendingPath | null {
  if (user?.mustChangePassword) return "/change-password";
  if (user?.mfaSetupRequired) return "/setup-two-factor";
  return null;
}
