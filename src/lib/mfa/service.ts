import type { Prisma } from "@prisma/client";
import { decryptField, encryptField, needsReencryption } from "@/lib/crypto";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { newSecurityStamp } from "@/lib/session-validity";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/mfa/totp";
import {
  generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode,
} from "@/lib/mfa/recovery";

/**
 * Every write to a user's second factor goes through here. Each function takes
 * the caller's transaction client, so the change and its audit row commit
 * together (same rule as the accounting services).
 *
 * Deciding *when* a second factor is required, and counting failed attempts
 * toward a lock, belongs to the sign-in flow (S1.7); this module answers "is
 * this code right" and keeps the state honest.
 */
type Db = Prisma.TransactionClient;

export type MfaErrorCode = "NOT_FOUND" | "ALREADY_ENABLED" | "NOT_ENROLLING" | "NOT_ENABLED" | "INVALID_CODE";

export class MfaError extends Error {
  constructor(public code: MfaErrorCode, message: string) {
    super(message);
  }
}

/** Binds each secret to its owner and purpose, so a copied ciphertext is useless elsewhere. */
export const totpContext = (userId: string) => `user:${userId}:totp`;

export interface AuditContext {
  actor: AuditActor;
  ipAddress?: string | null;
}

async function loadUser(db: Db, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpSecretEnc: true, totpEnabledAt: true, totpLastUsedStep: true },
  });
  if (!user) throw new MfaError("NOT_FOUND", "User not found");
  return user;
}

export const isMfaEnabled = (user: { totpSecretEnc: string | null; totpEnabledAt: Date | null }) =>
  user.totpSecretEnc !== null && user.totpEnabledAt !== null;

/** Starts (or restarts) enrolment: a fresh secret, stored encrypted and not yet live. */
export async function beginEnrolment(db: Db, userId: string): Promise<{ secret: string; uri: string }> {
  const user = await loadUser(db, userId);
  if (isMfaEnabled(user)) throw new MfaError("ALREADY_ENABLED", "Two-factor sign-in is already on");

  const secret = generateTotpSecret();
  await db.user.update({
    where: { id: userId },
    data: { totpSecretEnc: encryptField(secret, totpContext(userId)), totpEnabledAt: null, totpLastUsedStep: null },
  });
  return { secret, uri: otpauthUri(secret, user.email) };
}

/**
 * Finishes enrolment by proving the authenticator works. Returns the recovery
 * codes — the only time they are ever readable. The enrolling session is left
 * alone: its owner has just shown they hold the device.
 */
export async function confirmEnrolment(
  db: Db,
  userId: string,
  code: string,
  audit: AuditContext,
  now = Date.now()
): Promise<{ recoveryCodes: string[] }> {
  const user = await loadUser(db, userId);
  if (isMfaEnabled(user)) throw new MfaError("ALREADY_ENABLED", "Two-factor sign-in is already on");
  if (!user.totpSecretEnc) throw new MfaError("NOT_ENROLLING", "Start setting up two-factor sign-in first");

  const result = verifyTotp(decryptField(user.totpSecretEnc, totpContext(userId)), code, now, null);
  if (!result.ok) throw new MfaError("INVALID_CODE", "That code isn't right. Check the time on your phone and try again.");

  const recoveryCodes = await replaceRecoveryCodes(db, userId);
  await db.user.update({
    where: { id: userId },
    data: { totpEnabledAt: new Date(now), totpLastUsedStep: result.step },
  });
  await recordAudit(db, {
    actor: audit.actor,
    action: "mfa.enable",
    entityType: "User",
    entityId: userId,
    before: { mfa: false },
    after: { mfa: true },
    ipAddress: audit.ipAddress,
  });
  return { recoveryCodes };
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery" }
  | { ok: false; reason: "invalid" | "replay" };

/**
 * Checks what someone typed at the second-factor prompt: an authenticator code
 * or a recovery code. A code is good once. Both paths are single atomic
 * updates, so two requests racing with the same code cannot both win.
 */
export async function verifySecondFactor(
  db: Db,
  userId: string,
  input: string,
  audit: AuditContext,
  now = Date.now()
): Promise<SecondFactorResult> {
  const user = await loadUser(db, userId);
  if (!isMfaEnabled(user)) throw new MfaError("NOT_ENABLED", "Two-factor sign-in is not on for this user");

  if (looksLikeRecoveryCode(input)) {
    const used = await db.recoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(input), usedAt: null },
      data: { usedAt: new Date(now) },
    });
    if (used.count !== 1) return { ok: false, reason: "invalid" };
    await recordAudit(db, {
      actor: audit.actor,
      action: "mfa.recovery_used",
      entityType: "User",
      entityId: userId,
      ipAddress: audit.ipAddress,
    });
    return { ok: true, method: "recovery" };
  }

  const secret = decryptField(user.totpSecretEnc!, totpContext(userId));
  const result = verifyTotp(secret, input, now, user.totpLastUsedStep);
  if (!result.ok) return { ok: false, reason: result.reason };

  // The compare-and-set is what stops a replay: only a step later than the last
  // one used may win, so of two requests with one code exactly one updates a row.
  const claimed = await db.user.updateMany({
    where: { id: userId, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: result.step } }] },
    data: { totpLastUsedStep: result.step },
  });
  if (claimed.count !== 1) return { ok: false, reason: "replay" };

  // Rotation without a migration: a secret written under an old key is
  // re-saved under the current one the next time it is used.
  if (needsReencryption(user.totpSecretEnc!)) {
    await db.user.update({
      where: { id: userId },
      data: { totpSecretEnc: encryptField(secret, totpContext(userId)) },
    });
  }
  return { ok: true, method: "totp" };
}

async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const fresh = generateRecoveryCodes();
  await db.recoveryCode.deleteMany({ where: { userId } });
  await db.recoveryCode.createMany({ data: fresh.map(({ hash }) => ({ userId, codeHash: hash })) });
  return fresh.map(({ code }) => code);
}

/** New codes; every old one stops working. The caller must have verified a code first. */
export async function regenerateRecoveryCodes(db: Db, userId: string, audit: AuditContext): Promise<string[]> {
  const user = await loadUser(db, userId);
  if (!isMfaEnabled(user)) throw new MfaError("NOT_ENABLED", "Two-factor sign-in is not on for this user");
  const codes = await replaceRecoveryCodes(db, userId);
  await recordAudit(db, {
    actor: audit.actor,
    action: "mfa.recovery_regenerate",
    entityType: "User",
    entityId: userId,
    ipAddress: audit.ipAddress,
  });
  return codes;
}

export const recoveryCodesRemaining = (db: Db, userId: string) =>
  db.recoveryCode.count({ where: { userId, usedAt: null } });

/**
 * Turns the second factor off and ends every session (used when an admin resets
 * a lost authenticator, and by a user turning it off). The reason is kept.
 */
export async function disableMfa(db: Db, userId: string, audit: AuditContext, reason: string | null): Promise<void> {
  const user = await loadUser(db, userId);
  if (!user.totpSecretEnc && !user.totpEnabledAt) return;
  await db.recoveryCode.deleteMany({ where: { userId } });
  await db.user.update({
    where: { id: userId },
    data: { totpSecretEnc: null, totpEnabledAt: null, totpLastUsedStep: null, securityStamp: newSecurityStamp() },
  });
  await recordAudit(db, {
    actor: audit.actor,
    action: "mfa.disable",
    entityType: "User",
    entityId: userId,
    before: { mfa: isMfaEnabled(user) },
    after: { mfa: false },
    reason,
    ipAddress: audit.ipAddress,
  });
}
