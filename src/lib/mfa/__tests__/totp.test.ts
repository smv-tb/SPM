import { describe, it, expect } from "vitest";
import {
  base32Encode, base32Decode, generateTotpSecret, hotp, totpAt, totpStep, verifyTotp, otpauthUri,
} from "@/lib/mfa/totp";

// RFC 6238 appendix B, SHA-1: the secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("RFC 6238 test vectors", () => {
  it.each(RFC_VECTORS)("8 digits at T=%i is %s", (seconds, expected) => {
    expect(totpAt(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
  });

  it.each(RFC_VECTORS)("6 digits at T=%i is the last six of %s", (seconds, expected) => {
    expect(totpAt(RFC_SECRET, seconds * 1000)).toBe(expected.slice(-6));
  });
});

describe("RFC 4226 HOTP vectors", () => {
  it("matches appendix D for counters 0–9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    const key = Buffer.from("12345678901234567890");
    expect(expected.map((_, counter) => hotp(key, counter))).toEqual(expected);
  });
});

describe("base32", () => {
  it("matches RFC 4648's vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
  });

  it("round-trips random bytes and tolerates spaces, dashes and lowercase", () => {
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    const spaced = secret.toLowerCase().replace(/(.{4})/g, "$1 ");
    expect(base32Decode(spaced).equals(base32Decode(secret))).toBe(true);
  });

  it("rejects characters that are not base32", () => {
    expect(() => base32Decode("NOT*VALID")).toThrow();
    expect(() => base32Decode("1890")).toThrow();
  });
});

describe("generateTotpSecret", () => {
  it("is 160 bits, unique, and base32", () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(a);
  });
});

describe("verifyTotp", () => {
  const T = 1_700_000_000_000;
  const at = (offsetSteps: number) => totpAt(RFC_SECRET, T + offsetSteps * 30_000);

  it("accepts the current code and reports its step", () => {
    expect(verifyTotp(RFC_SECRET, at(0), T, null)).toEqual({ ok: true, step: totpStep(T) });
  });

  it("allows one step of clock skew either way, and no more", () => {
    expect(verifyTotp(RFC_SECRET, at(-1), T, null).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, at(1), T, null).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, at(-2), T, null)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyTotp(RFC_SECRET, at(2), T, null)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a code that has already been used", () => {
    const first = verifyTotp(RFC_SECRET, at(0), T, null);
    expect(first.ok).toBe(true);
    if (first.ok) expect(verifyTotp(RFC_SECRET, at(0), T, first.step)).toEqual({ ok: false, reason: "replay" });
  });

  it("refuses an older code once a newer one has been used", () => {
    expect(verifyTotp(RFC_SECRET, at(-1), T, totpStep(T))).toEqual({ ok: false, reason: "replay" });
  });

  it("accepts the next step's code after the current one was used", () => {
    expect(verifyTotp(RFC_SECRET, at(1), T, totpStep(T)).ok).toBe(true);
  });

  it("refuses wrong, short, long and non-numeric input", () => {
    for (const bad of ["000000", "12345", "1234567", "abcdef", "", "12 34 5"]) {
      expect(verifyTotp(RFC_SECRET, bad, T, null).ok).toBe(false);
    }
  });

  it("ignores spaces inside the code, as authenticator apps display them", () => {
    const code = at(0);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, T, null).ok).toBe(true);
  });
});

describe("otpauthUri", () => {
  it("carries the secret, issuer and parameters apps need", () => {
    const uri = new URL(otpauthUri("JBSWY3DPEHPK3PXP", "jane.doe@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Smartvie PM:jane.doe@example.com");
    expect(uri.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(uri.searchParams.get("issuer")).toBe("Smartvie PM");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });
});
