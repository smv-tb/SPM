import { describe, it, expect } from "vitest";
import { AccountingError } from "@/lib/accounting/errors";
import { toLedgerDate } from "@/lib/accounting/dates";
import {
  assertAllocationDate,
  isBankAccountCode,
  receiptPostingLines,
  refundPostingLines,
} from "@/lib/accounting/payment";
import { bucketFor, buildAgedDebtors, daysBetween } from "@/lib/accounting/aged-debtors";
import { allocationAmount } from "@/lib/accounting/credit-note";

const d = (key: string) => toLedgerDate(key);

describe("receipt and refund journals", () => {
  it("a receipt debits the bank and credits trade debtors", () => {
    expect(receiptPostingLines(125000, "bank", "debtors")).toEqual([
      { accountId: "bank", debit: 125000, credit: 0 },
      { accountId: "debtors", debit: 0, credit: 125000 },
    ]);
  });

  it("a refund is the same journal the other way round", () => {
    expect(refundPostingLines(5000, "bank", "debtors")).toEqual([
      { accountId: "debtors", debit: 5000, credit: 0 },
      { accountId: "bank", debit: 0, credit: 5000 },
    ]);
  });

  it("refuses nothing, negatives and fractions of a penny", () => {
    expect(() => receiptPostingLines(0, "b", "d")).toThrow(AccountingError);
    expect(() => refundPostingLines(-1, "b", "d")).toThrow(AccountingError);
    expect(() => receiptPostingLines(1.5, "b", "d")).toThrow(AccountingError);
  });
});

describe("isBankAccountCode", () => {
  it("accepts the 12xx range only", () => {
    expect(isBankAccountCode("1200")).toBe(true);
    expect(isBankAccountCode("1210")).toBe(true);
    expect(isBankAccountCode("1100")).toBe(false);
    expect(isBankAccountCode("1300")).toBe(false);
    expect(isBankAccountCode("12000")).toBe(false);
  });
});

describe("assertAllocationDate", () => {
  it("allows the day of the later document, or after", () => {
    expect(() => assertAllocationDate(d("2026-06-01"), [d("2026-05-26"), d("2026-06-01")])).not.toThrow();
    expect(() => assertAllocationDate(d("2026-07-01"), [d("2026-05-26")])).not.toThrow();
  });

  it("refuses settling an invoice before it was raised", () => {
    expect(() => assertAllocationDate(d("2026-05-25"), [d("2026-05-01"), d("2026-05-26")])).toThrow(
      /cannot be dated before 2026-05-26/
    );
  });
});

describe("allocationAmount for a payment", () => {
  it("names the payment when refusing", () => {
    expect(() =>
      allocationAmount({ requested: 501, creditRemaining: 500, invoiceDue: 900, source: "the payment" })
    ).toThrow("That is more than the payment has left to allocate");
  });
});

describe("aging", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween(d("2026-09-30"), d("2026-10-31"))).toBe(31);
    // Across the clocks going back: still whole days.
    expect(daysBetween(d("2026-10-24"), d("2026-10-26"))).toBe(2);
  });

  it("is not late on the due date, and late from the day after", () => {
    const asAt = d("2026-10-31");
    expect(bucketFor(d("2026-10-31"), asAt)).toBe("current");
    expect(bucketFor(d("2026-11-15"), asAt)).toBe("current");
    expect(bucketFor(d("2026-10-30"), asAt)).toBe("days1to30");
    expect(bucketFor(d("2026-10-01"), asAt)).toBe("days1to30");
    expect(bucketFor(d("2026-09-30"), asAt)).toBe("days31to60");
    // 2 August is 90 days before 31 October; 1 August is 91.
    expect(bucketFor(d("2026-08-02"), asAt)).toBe("days61to90");
    expect(bucketFor(d("2026-08-01"), asAt)).toBe("over90");
  });
});

describe("buildAgedDebtors", () => {
  const asAt = d("2026-10-31");
  const report = buildAgedDebtors(
    asAt,
    [
      { id: "a", number: "INV001", contactId: "acme", contactName: "Acme", dueDate: d("2026-11-10"), outstanding: 50000 },
      { id: "b", number: "INV002", contactId: "acme", contactName: "Acme", dueDate: d("2026-07-01"), outstanding: 25000 },
      { id: "c", number: "INV003", contactId: "zeta", contactName: "Zeta", dueDate: d("2026-10-15"), outstanding: 125000 },
      { id: "d", number: "INV004", contactId: "zeta", contactName: "Zeta", dueDate: d("2026-10-15"), outstanding: 0 },
    ],
    [
      { contactId: "acme", contactName: "Acme", amount: 10000 },
      { contactId: "credit-only", contactName: "Overpaid Ltd", amount: 3000 },
    ]
  );

  it("puts each invoice in its bucket and nets unused credit", () => {
    const acme = report.rows.find((r) => r.contactId === "acme")!;
    expect(acme.current).toBe(50000);
    expect(acme.over90).toBe(25000);
    expect(acme.unusedCredit).toBe(10000);
    expect(acme.balance).toBe(65000);
  });

  it("leaves settled invoices out", () => {
    const zeta = report.rows.find((r) => r.contactId === "zeta")!;
    expect(zeta.invoices.map((i) => i.number)).toEqual(["INV003"]);
  });

  it("shows a customer who is only in credit as a negative balance", () => {
    expect(report.rows.find((r) => r.contactId === "credit-only")!.balance).toBe(-3000);
  });

  it("orders the biggest debts first and totals every column", () => {
    expect(report.rows.map((r) => r.contactId)).toEqual(["zeta", "acme", "credit-only"]);
    expect(report.totals).toEqual({
      current: 50000,
      days1to30: 125000,
      days31to60: 0,
      days61to90: 0,
      over90: 25000,
      unusedCredit: 13000,
      balance: 187000,
    });
  });
});
