import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30 s, 6 digits — what
 * every authenticator app expects). Written against node:crypto rather than a
 * package: it is ~40 lines, there is nothing to keep patched in the most
 * security-sensitive path, and it is verified against the RFC's own vectors.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
const SECRET_BYTES = 20; // 160 bits, what RFC 4226 recommends

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Not a base32 string");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The RFC 4226 HOTP value for one counter. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Which 30-second step a moment falls in. This is what replay protection records. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpAt(secret: string, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secret), totpStep(nowMs), digits);
}

export type TotpResult =
  | { ok: true; step: number }
  | { ok: false; reason: "invalid" | "replay" };

/**
 * Checks a code against the current step and one either side (a phone's clock
 * is rarely exact). A code is accepted for a step later than `lastUsedStep`
 * only: a code that was already used — or one from an earlier step than one
 * already used — is refused even though it is "correct", which is what stops a
 * shoulder-surfed or intercepted code being used a second time.
 *
 * All candidate steps are compared whether or not an earlier one matched.
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null,
  skewSteps = 1
): TotpResult {
  const submitted = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(submitted)) return { ok: false, reason: "invalid" };

  const key = base32Decode(secret);
  const current = totpStep(nowMs);
  let matchedStep: number | null = null;
  for (let step = current - skewSteps; step <= current + skewSteps; step++) {
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(submitted)) && matchedStep === null) matchedStep = step;
  }
  if (matchedStep === null) return { ok: false, reason: "invalid" };
  if (lastUsedStep !== null && matchedStep <= lastUsedStep) return { ok: false, reason: "replay" };
  return { ok: true, step: matchedStep };
}

/** The `otpauth://` URI authenticator apps read from a QR code. */
export function otpauthUri(secret: string, accountEmail: string, issuer = "Smartvie PM"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query}`;
}
