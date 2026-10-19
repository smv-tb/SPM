import { describe, it, expect } from "vitest";
import { bankChangeNotice, bankDetailsChanged } from "@/lib/accounting/bank-details-change";

const existing = { bankAccountName: "Example Ltd", bankSortCode: "11-22-33", bankAccountNumber: "11112222" };

describe("bankDetailsChanged", () => {
  it("is true when the account number is swapped", () => {
    expect(bankDetailsChanged(existing, { bankAccountNumber: "99998888" })).toBe(true);
  });

  it("is true for the sort code or the account name too", () => {
    expect(bankDetailsChanged(existing, { bankSortCode: "20-00-00" })).toBe(true);
    expect(bankDetailsChanged(existing, { bankAccountName: "Someone Else" })).toBe(true);
  });

  it("is false when the same values are sent back (a form that resubmits everything)", () => {
    expect(bankDetailsChanged(existing, { ...existing })).toBe(false);
  });

  it("is false when the update doesn't mention the bank at all", () => {
    expect(bankDetailsChanged(existing, {})).toBe(false);
  });

  it("treats empty, whitespace and null as the same 'no value'", () => {
    expect(bankDetailsChanged({ bankSortCode: null }, { bankSortCode: "" })).toBe(false);
    expect(bankDetailsChanged({ bankSortCode: null }, { bankSortCode: "  " })).toBe(false);
    expect(bankDetailsChanged({ bankSortCode: "" }, { bankSortCode: null })).toBe(false);
  });

  it("is true when details are cleared, or first set", () => {
    expect(bankDetailsChanged(existing, { bankAccountNumber: null })).toBe(true);
    expect(bankDetailsChanged(null, { bankAccountNumber: "11112222" })).toBe(true);
  });

  it("ignores whitespace around an otherwise identical value", () => {
    expect(bankDetailsChanged(existing, { bankAccountNumber: " 11112222 " })).toBe(false);
  });
});

describe("bankChangeNotice", () => {
  const at = new Date("2026-10-02T09:00:00Z");
  it("shows until three invoices have been approved since the change", () => {
    expect(bankChangeNotice(at, "a@example.com", 0)).toEqual({ changedAt: at.toISOString(), changedBy: "a@example.com" });
    expect(bankChangeNotice(at, null, 2)).not.toBeNull();
    expect(bankChangeNotice(at, null, 3)).toBeNull();
  });
  it("is absent when nothing ever changed", () => {
    expect(bankChangeNotice(null, null, 0)).toBeNull();
  });
});
