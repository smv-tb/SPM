/**
 * Per-account login throttling rules. The per-IP limiter in auth.ts stops one
 * machine guessing; this stops many machines guessing at one account.
 *
 * Accounts are keyed by the lower-cased email whether or not such a user
 * exists, so being locked tells an attacker nothing about who has an account.
 * Pure (no Prisma, no clock) so the rules can be unit-tested.
 */
export const ACCOUNT_LOCK = {
  /** Wrong passwords tolerated before the account is locked. */
  maxFailures: 10,
  /** The lock lasts this long after the last counted failure. */
  windowMs: 15 * 60 * 1000,
} as const;

/**
 * Wrong second-factor codes get their own, tighter counter. A 6-digit code is
 * far easier to guess than a password, and whoever is guessing already has the
 * password, so ten tries per 15 minutes would still let a patient attacker
 * through over weeks. Five wrong codes lock the account's second step for an
 * hour (about 0.04% a day of getting lucky, against ~10% a month before).
 */
export const MFA_LOCK = {
  maxFailures: 5,
  windowMs: 60 * 60 * 1000,
} as const;

export interface FailureRow {
  attempts: number;
  expiresAt: Date;
}

export function loginAccountKey(email: string): string {
  return `account:${email.trim().toLowerCase()}`;
}

export function mfaFailureKey(email: string): string {
  return `mfa:${email.trim().toLowerCase()}`;
}

export function accountLocked(row: FailureRow | null, now: number, maxFailures: number = ACCOUNT_LOCK.maxFailures): boolean {
  return row !== null && row.expiresAt.getTime() > now && row.attempts >= maxFailures;
}

/** True when the stored count belongs to a finished window and must restart at 1. */
export function failureWindowExpired(row: FailureRow | null, now: number): boolean {
  return row === null || row.expiresAt.getTime() <= now;
}

const MAX_EMAIL_LENGTH = 254; // RFC 5321
const MAX_PASSWORD_LENGTH = 1024;

/**
 * Credentials worth checking at all. bcrypt only reads the first 72 bytes, so
 * a megabyte "password" buys an attacker nothing but our CPU and memory.
 */
export function plausibleCredentials(email: unknown, password: unknown): email is string {
  return (
    typeof email === "string" &&
    typeof password === "string" &&
    email.length > 0 &&
    password.length > 0 &&
    email.length <= MAX_EMAIL_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}
