import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { parseKeyring } from "@/lib/crypto";
import {
  SETTINGS_NUMBER_CONTEXT, auditableBankAccount, auditableSettings, bankAccountIndex, bankAccountIndexCandidates,
  bankAccountNumberContext, isSealed, maskNumber, maskedNumberOrUnreadable, openNumber, sealNumber,
} from "@/lib/accounting/bank-numbers";

const k = () => randomBytes(32).toString("base64");
const k1 = k();
const k2 = k();
const ring = parseKeyring(`k1:${k1}`);
const rotated = parseKeyring(`k2:${k2},k1:${k1}`);
const ctx = bankAccountNumberContext("acct-1");

describe("sealing", () => {
  it("round-trips and does not contain the number", () => {
    const sealed = sealNumber("12345678", ctx, ring);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("12345678");
    expect(openNumber(sealed, ctx, ring)).toBe("12345678");
  });

  it("passes a legacy plain number straight through", () => {
    expect(isSealed("12345678")).toBe(false);
    expect(openNumber("12345678", ctx, ring)).toBe("12345678");
  });

  it("will not open under another row's context", () => {
    const sealed = sealNumber("12345678", ctx, ring);
    expect(() => openNumber(sealed, bankAccountNumberContext("acct-2"), ring)).toThrow();
    expect(() => openNumber(sealed, SETTINGS_NUMBER_CONTEXT, ring)).toThrow();
  });

  it("still opens after the key is rotated", () => {
    const sealed = sealNumber("12345678", ctx, ring);
    expect(openNumber(sealed, ctx, rotated)).toBe("12345678");
  });
});

describe("maskNumber", () => {
  it("keeps the last four digits only", () => {
    expect(maskNumber("12345678")).toBe("••••5678");
    expect(maskNumber(null)).toBeNull();
    expect(maskNumber("")).toBeNull();
  });
});

describe("duplicate detection index", () => {
  it("is the same for the same sort code and number, and different otherwise", () => {
    expect(bankAccountIndex("309950", "12345678", ring)).toBe(bankAccountIndex("309950", "12345678", ring));
    expect(bankAccountIndex("309950", "12345678", ring)).not.toBe(bankAccountIndex("309951", "12345678", ring));
    expect(bankAccountIndex("309950", "12345678", ring)).not.toBe(bankAccountIndex("309950", "12345679", ring));
  });

  it("is found under the old key after rotation", () => {
    const stored = bankAccountIndex("309950", "12345678", ring);
    expect(bankAccountIndexCandidates("309950", "12345678", rotated)).toContain(stored);
  });
});

describe("what the audit log may see", () => {
  const row = {
    id: "acct-1", name: "Main", sortCode: "309950",
    accountNumber: sealNumber("12345678", ctx, ring), accountNumberIdx: "k1:abc",
  };

  it("masks a bank account's number, drops the index, and keeps a keyed reference", () => {
    const a = auditableBankAccount(row, ring);
    expect(a.accountNumber).toBe("••••5678");
    expect(JSON.stringify(a)).not.toContain("12345678");
    expect(JSON.stringify(a)).not.toContain("v1.");
    expect("accountNumberIdx" in a).toBe(false);
    // Changing only the leading digits must still change the record.
    const other = auditableBankAccount({ ...row, accountNumber: sealNumber("99995678", ctx, ring) }, ring);
    expect(other.numberRef).not.toBe(a.numberRef);
  });

  it("handles a legacy plain row the same way", () => {
    expect(auditableBankAccount({ ...row, accountNumber: "12345678" }, ring).accountNumber).toBe("••••5678");
  });

  it("masks the company's number and tolerates none", () => {
    const sealed = sealNumber("87654321", SETTINGS_NUMBER_CONTEXT, ring);
    const s = auditableSettings({ legalName: "X", bankAccountNumber: sealed }, ring)!;
    expect(s.bankAccountNumber).toBe("••••4321");
    expect(JSON.stringify(s)).not.toContain("87654321");
    expect(auditableSettings({ bankAccountNumber: null }, ring)!.bankAccountNumber).toBeNull();
    expect(auditableSettings(null, ring)).toBeNull();
  });
});

describe("maskedNumberOrUnreadable", () => {
  it("masks a readable number, sealed or legacy", () => {
    expect(maskedNumberOrUnreadable(sealNumber("12345678", ctx, ring), ctx, ring)).toBe("••••5678");
    expect(maskedNumberOrUnreadable("12345678", ctx, ring)).toBe("••••5678");
  });
  it("does not throw when the key is gone, and says why", () => {
    const sealed = sealNumber("12345678", ctx, ring);
    const other = parseKeyring(`k9:${k()}`);
    expect(maskedNumberOrUnreadable(sealed, ctx, other)).toMatch(/unreadable/);
  });
});
