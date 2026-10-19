import { describe, it, expect } from "vitest";
import {
  generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode, looksLikeRecoveryCode, RECOVERY_CODE_COUNT,
} from "@/lib/mfa/recovery";

describe("generateRecoveryCodes", () => {
  const codes = generateRecoveryCodes();

  it("makes the expected number, all different", () => {
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes.map((c) => c.code)).size).toBe(RECOVERY_CODE_COUNT);
    expect(new Set(codes.map((c) => c.hash)).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("formats as four groups of four from an alphabet with no look-alikes", () => {
    for (const { code } of codes) expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  });

  it("stores only a hash that matches however the code is typed back", () => {
    const { code, hash } = codes[0];
    expect(hashRecoveryCode(code)).toBe(hash);
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hash);
    expect(hashRecoveryCode(code.replace(/-/g, " "))).toBe(hash);
    expect(hashRecoveryCode(code.replace(/-/g, ""))).toBe(hash);
    expect(hash).not.toContain(code.replace(/-/g, ""));
  });

  it("gives a different hash for a different code", () => {
    expect(hashRecoveryCode(codes[0].code)).not.toBe(hashRecoveryCode(codes[1].code));
  });
});

describe("looksLikeRecoveryCode", () => {
  it("accepts a real code in any common typing", () => {
    const { code } = generateRecoveryCodes(1)[0];
    expect(looksLikeRecoveryCode(code)).toBe(true);
    expect(looksLikeRecoveryCode(code.toLowerCase().replace(/-/g, " "))).toBe(true);
  });

  it("refuses a 6-digit authenticator code, and anything else the wrong shape", () => {
    for (const bad of ["123456", "", "ABCD-EFGH", "ABCD-EFGH-IJKL-MNOP-QRST", "0000-0000-0000-0000"]) {
      expect(looksLikeRecoveryCode(bad)).toBe(false);
    }
  });
});

describe("normaliseRecoveryCode", () => {
  it("strips everything but letters and digits", () => {
    expect(normaliseRecoveryCode(" ab-cd  ef_12 ")).toBe("ABCDEF12");
  });
});
