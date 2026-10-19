import { createHash, randomBytes } from "node:crypto";
import { base32Encode } from "@/lib/mfa/totp";

/**
 * One-time recovery codes for a lost authenticator.
 *
 * Each is 80 random bits (16 base32 characters, shown `XXXX-XXXX-XXXX-XXXX`).
 * They are stored as a plain SHA-256: at 80 bits an attacker with a copy of the
 * table still has 2^80 guesses to make, so a slow hash buys nothing — and a
 * plain hash means a code is found with one indexed lookup (not ten bcrypt
 * compares per attempt) and survives rotating the encryption key, which a
 * keyed hash would not. Low-entropy secrets (passwords) are a different case.
 */
export const RECOVERY_CODE_COUNT = 10;
const CODE_CHARS = 16;

/** Uppercase, letters and digits only: what people type, with or without dashes and spaces. */
export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(input: string): string {
  return createHash("sha256").update(normaliseRecoveryCode(input)).digest("hex");
}

/** Whether input could be a recovery code at all — checked before touching the database. */
export function looksLikeRecoveryCode(input: string): boolean {
  return /^[A-Z2-7]{16}$/.test(normaliseRecoveryCode(input));
}

export function formatRecoveryCode(code: string): string {
  return code.match(/.{4}/g)!.join("-");
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): { code: string; hash: string }[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(10)).slice(0, CODE_CHARS); // 10 bytes = 80 bits = 16 chars
    return { code: formatRecoveryCode(raw), hash: hashRecoveryCode(raw) };
  });
}
