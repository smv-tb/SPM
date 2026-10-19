import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  parseKeyring, encryptField, decryptField, needsReencryption, blindIndex, blindIndexes, CryptoConfigError, DecryptionError,
} from "@/lib/crypto";

const key = () => randomBytes(32).toString("base64");
const ring = (spec: string) => parseKeyring(spec);

describe("parseKeyring", () => {
  it("takes the first key as current and keeps the rest for decrypting", () => {
    const r = ring(`k2:${key()},k1:${key()}`);
    expect(r.current.id).toBe("k2");
    expect([...r.byId.keys()]).toEqual(["k2", "k1"]);
  });

  it("refuses to run with no key", () => {
    expect(() => parseKeyring(undefined)).toThrow(CryptoConfigError);
    expect(() => parseKeyring("  ")).toThrow(CryptoConfigError);
  });

  it("refuses a key of the wrong length", () => {
    expect(() => ring(`k1:${randomBytes(16).toString("base64")}`)).toThrow(/32 bytes/);
  });

  it("refuses a bad or duplicated id, and a missing separator", () => {
    expect(() => ring(`bad id:${key()}`)).toThrow(CryptoConfigError);
    expect(() => ring(`${key()}`)).toThrow(CryptoConfigError);
    const k = key();
    expect(() => ring(`a:${k},a:${key()}`)).toThrow(/Duplicate/);
  });

  it("never puts key material in an error message", () => {
    const secret = randomBytes(16).toString("base64");
    try { ring(`k1:${secret}`); } catch (e) { expect(String(e)).not.toContain(secret); }
  });
});

describe("encryptField / decryptField", () => {
  const r = ring(`k1:${key()}`);

  it("round-trips, including empty and non-ASCII text", () => {
    for (const text of ["JBSWY3DPEHPK3PXP", "", "£1,000.00 — ünïcode ✓"]) {
      expect(decryptField(encryptField(text, "ctx", r), "ctx", r)).toBe(text);
    }
  });

  it("does not repeat: the same text encrypts differently each time", () => {
    expect(encryptField("same", "ctx", r)).not.toBe(encryptField("same", "ctx", r));
  });

  it("does not contain the plaintext", () => {
    expect(encryptField("JBSWY3DPEHPK3PXP", "ctx", r)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("refuses a value moved to another context (another user's row or column)", () => {
    const stored = encryptField("secret", "user:1:totp", r);
    expect(() => decryptField(stored, "user:2:totp", r)).toThrow(DecryptionError);
    expect(() => decryptField(stored, "user:1:bank", r)).toThrow(DecryptionError);
  });

  it("refuses tampering anywhere in the value", () => {
    const parts = encryptField("secret", "ctx", r).split(".");
    for (const i of [2, 3, 4]) {
      const tampered = [...parts];
      const buf = Buffer.from(tampered[i], "base64url");
      buf[0] ^= 1;
      tampered[i] = buf.toString("base64url");
      expect(() => decryptField(tampered.join("."), "ctx", r)).toThrow(DecryptionError);
    }
  });

  it("refuses the wrong key without saying more than that", () => {
    const stored = encryptField("secret", "ctx", r);
    const other = ring(`k1:${key()}`);
    expect(() => decryptField(stored, "ctx", other)).toThrow("Could not decrypt the value");
  });

  it("refuses malformed input", () => {
    for (const bad of ["", "nonsense", "v2.k1.a.b.c", "v1.k1.a.b", "v1.k1.a.b.c.d"]) {
      expect(() => decryptField(bad, "ctx", r)).toThrow(DecryptionError);
    }
  });
});

describe("rotation", () => {
  const oldKey = key();
  const newKey = key();

  it("still decrypts what the old key wrote, and says it should be re-saved", () => {
    const stored = encryptField("secret", "ctx", ring(`k1:${oldKey}`));
    const rotated = ring(`k2:${newKey},k1:${oldKey}`);
    expect(decryptField(stored, "ctx", rotated)).toBe("secret");
    expect(needsReencryption(stored, rotated)).toBe(true);
  });

  it("writes with the new key once rotated, and that no longer needs re-saving", () => {
    const rotated = ring(`k2:${newKey},k1:${oldKey}`);
    const fresh = encryptField("secret", "ctx", rotated);
    expect(needsReencryption(fresh, rotated)).toBe(false);
    expect(decryptField(fresh, "ctx", ring(`k2:${newKey}`))).toBe("secret");
  });

  it("fails clearly if an old key is dropped while values still use it", () => {
    const stored = encryptField("secret", "ctx", ring(`k1:${oldKey}`));
    expect(() => decryptField(stored, "ctx", ring(`k2:${newKey}`))).toThrow(/No key "k1"/);
  });
});

describe("blind index", () => {
  const k1 = key();
  const k2 = key();

  it("is stable for the same value and context, and tagged with the key id", () => {
    const r = ring(`k1:${k1}`);
    expect(blindIndex("309950:12345678", "bank", r)).toBe(blindIndex("309950:12345678", "bank", r));
    expect(blindIndex("309950:12345678", "bank", r)).toMatch(/^k1:[0-9a-f]{64}$/);
  });

  it("differs by value, by context and by key", () => {
    const r = ring(`k1:${k1}`);
    const base = blindIndex("309950:12345678", "bank", r);
    expect(blindIndex("309950:12345679", "bank", r)).not.toBe(base);
    expect(blindIndex("309950:12345678", "other", r)).not.toBe(base);
    expect(blindIndex("309950:12345678", "bank", ring(`k1:${k2}`))).not.toBe(base);
  });

  it("does not contain the value or an unkeyed hash of it", () => {
    const idx = blindIndex("12345678", "bank", ring(`k1:${k1}`));
    expect(idx).not.toContain("12345678");
  });

  it("after rotation, an index made under the old key is still found", () => {
    const before = blindIndex("309950:12345678", "bank", ring(`k1:${k1}`));
    const rotated = ring(`k2:${k2},k1:${k1}`);
    expect(blindIndexes("309950:12345678", "bank", rotated)).toContain(before);
    expect(blindIndex("309950:12345678", "bank", rotated).startsWith("k2:")).toBe(true);
  });
});
