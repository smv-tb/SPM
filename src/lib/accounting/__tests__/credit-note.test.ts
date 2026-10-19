import { describe, it, expect } from "vitest";
import { AccountingError } from "@/lib/accounting/errors";
import {
  allocationAmount,
  amountDue,
  assertCreditNoteTransition,
  creditNotePostingLines,
  settledStatus,
} from "@/lib/accounting/credit-note";
import { invoicePostingLines, validateInvoice } from "@/lib/accounting/invoice";
import { toMilli } from "@/lib/accounting/sales";
import { toPence } from "@/lib/money";

describe("creditNotePostingLines", () => {
  const lines = [
    { amount: toPence("250.00"), incomeAccountId: null },
    { amount: toPence("100.00"), incomeAccountId: "consulting" },
    { amount: toPence("50.00"), incomeAccountId: null },
  ];

  it("debits income and credits debtors — the invoice's journal the other way round", () => {
    expect(creditNotePostingLines(lines, "debtors", "sales")).toEqual([
      { accountId: "debtors", debit: 0, credit: 40000 },
      { accountId: "sales", debit: 30000, credit: 0 },
      { accountId: "consulting", debit: 10000, credit: 0 },
    ]);
  });

  it("nets an invoice and its full credit note to zero on every account", () => {
    const net = new Map<string, number>();
    for (const l of [
      ...invoicePostingLines(lines, "debtors", "sales"),
      ...creditNotePostingLines(lines, "debtors", "sales"),
    ]) {
      net.set(l.accountId, (net.get(l.accountId) ?? 0) + l.debit - l.credit);
    }
    expect([...net.values()].every((v) => v === 0)).toBe(true);
  });

  it("balances", () => {
    const posted = creditNotePostingLines(lines, "debtors", "sales");
    const debit = posted.reduce((s, l) => s + l.debit, 0);
    const credit = posted.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
  });
});

describe("assertCreditNoteTransition", () => {
  it("allows draft → approved → void", () => {
    expect(() => assertCreditNoteTransition("DRAFT", "APPROVED")).not.toThrow();
    expect(() => assertCreditNoteTransition("APPROVED", "VOID")).not.toThrow();
    expect(() => assertCreditNoteTransition("DRAFT", "VOID")).not.toThrow();
  });

  it("refuses going back, and anything after a void", () => {
    expect(() => assertCreditNoteTransition("APPROVED", "DRAFT")).toThrow(AccountingError);
    expect(() => assertCreditNoteTransition("APPROVED", "APPROVED")).toThrow(/cannot become/);
    expect(() => assertCreditNoteTransition("VOID", "APPROVED")).toThrow(/final/);
  });
});

describe("settledStatus", () => {
  it("is paid once fully settled, part paid when partly", () => {
    expect(settledStatus("SENT", 50000, 50000, "2026-09-22")).toBe("PAID");
    expect(settledStatus("SENT", 50000, 20000, "2026-09-22")).toBe("PART_PAID");
  });

  it("goes back to sent or approved when the settlement is removed", () => {
    expect(settledStatus("PAID", 50000, 0, "2026-09-22")).toBe("SENT");
    expect(settledStatus("PART_PAID", 50000, 0, null)).toBe("APPROVED");
  });

  it("leaves drafts and voids alone", () => {
    expect(settledStatus("DRAFT", 50000, 50000, null)).toBe("DRAFT");
    expect(settledStatus("VOID", 50000, 0, null)).toBe("VOID");
  });
});

describe("amountDue", () => {
  it("subtracts what has been applied, never below zero", () => {
    expect(amountDue(125000, [25000, 10000])).toBe(90000);
    expect(amountDue(125000, [])).toBe(125000);
    expect(amountDue(125000, [125000, 1])).toBe(0);
  });
});

describe("allocationAmount", () => {
  it("takes as much as both sides allow when no amount is given", () => {
    expect(allocationAmount({ creditRemaining: 30000, invoiceDue: 50000 })).toBe(30000);
    expect(allocationAmount({ creditRemaining: 80000, invoiceDue: 50000 })).toBe(50000);
    expect(allocationAmount({ creditRemaining: 0, invoiceDue: 50000 })).toBe(0);
  });

  it("accepts an explicit amount within both limits", () => {
    expect(allocationAmount({ requested: 12345, creditRemaining: 30000, invoiceDue: 50000 })).toBe(12345);
  });

  it("refuses an explicit amount rather than trimming it", () => {
    expect(() => allocationAmount({ requested: 30001, creditRemaining: 30000, invoiceDue: 50000 })).toThrow(
      /credit note has left/
    );
    expect(() => allocationAmount({ requested: 50001, creditRemaining: 90000, invoiceDue: 50000 })).toThrow(
      /invoice still owes/
    );
    expect(() => allocationAmount({ requested: 0, creditRemaining: 1, invoiceDue: 1 })).toThrow(/more than zero/);
    expect(() => allocationAmount({ requested: 1.5, creditRemaining: 9, invoiceDue: 9 })).toThrow(AccountingError);
  });
});

describe("validateInvoice for a credit note", () => {
  it("names the document it is checking", () => {
    const problems = validateInvoice({ lines: [] }, "approve", "credit note");
    expect(problems.map((p) => p.message)).toContain("A credit note needs at least one line");
  });

  it("does not tell a credit note to raise a credit note", () => {
    const problems = validateInvoice(
      { lines: [{ name: "x", unit: "day", quantity: toMilli("0"), unitPrice: 100 }] },
      "draft",
      "credit note"
    );
    expect(problems[0].message).toBe("A quantity must be more than zero");
  });
});
