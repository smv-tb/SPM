import { describe, it, expect } from "vitest";
import { AccountingError } from "@/lib/accounting/errors";
import {
  assertTransition,
  canTransition,
  formatInvoiceNumber,
  invoicePostingLines,
  isEditable,
  priceInvoice,
  validateInvoice,
  type InvoiceLineInput,
} from "@/lib/accounting/invoice";
import { toMilli } from "@/lib/accounting/sales";
import { toPence } from "@/lib/money";

function line(overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput {
  return {
    name: "BI Consultation",
    unit: "day",
    quantity: toMilli("0.5"),
    unitPrice: toPence("500.00"),
    ...overrides,
  };
}

describe("formatInvoiceNumber", () => {
  it("pads to the configured width", () => {
    expect(formatInvoiceNumber("INV", 1, 3)).toBe("INV001");
    expect(formatInvoiceNumber("INV", 24, 3)).toBe("INV024");
  });

  it("grows past the padding rather than wrapping", () => {
    expect(formatInvoiceNumber("INV", 1000, 3)).toBe("INV1000");
  });

  it("takes any configured prefix, including none", () => {
    expect(formatInvoiceNumber("SMV-", 7, 4)).toBe("SMV-0007");
    expect(formatInvoiceNumber("", 7, 3)).toBe("007");
  });

  it.each([0, -1, 1.5])("refuses %j as a sequence", (n) => {
    expect(() => formatInvoiceNumber("INV", n, 3)).toThrow(AccountingError);
  });
});

describe("priceInvoice", () => {
  it("prices INV023 exactly: 0.5 days at £500.00", () => {
    const priced = priceInvoice([line()]);
    expect(priced.lines[0].amount).toBe(25_000);
    expect(priced.subtotal).toBe(25_000);
    // No VAT until registration, so the total is the subtotal.
    expect(priced.total).toBe(25_000);
  });

  it("adds lines in pence, not floats", () => {
    const priced = priceInvoice([
      line({ quantity: toMilli("1"), unitPrice: toPence("0.10") }),
      line({ quantity: toMilli("1"), unitPrice: toPence("0.20") }),
    ]);
    expect(priced.total).toBe(30);
  });

  it("is zero for no lines", () => {
    expect(priceInvoice([]).total).toBe(0);
  });
});

describe("validateInvoice", () => {
  it("accepts a normal line", () => {
    expect(validateInvoice({ lines: [line()] }, "approve")).toEqual([]);
  });

  it("refuses a nameless or unitless line, naming the line", () => {
    const problems = validateInvoice({ lines: [line(), line({ name: "  " })] }, "draft");
    expect(problems).toEqual([{ code: "LINE_NAME", message: expect.any(String), line: 2 }]);
  });

  it("refuses a zero or negative quantity — that is a credit note", () => {
    expect(validateInvoice({ lines: [line({ quantity: 0 })] }, "draft")[0].code).toBe("LINE_QUANTITY");
    expect(validateInvoice({ lines: [line({ quantity: toMilli("-1") })] }, "draft")[0].code).toBe(
      "LINE_QUANTITY"
    );
  });

  it("lets a draft have no lines, but not an approval", () => {
    expect(validateInvoice({ lines: [] }, "draft")).toEqual([]);
    expect(validateInvoice({ lines: [] }, "approve").map((p) => p.code)).toContain("NO_LINES");
  });

  it("refuses to approve an invoice for nothing", () => {
    const problems = validateInvoice({ lines: [line({ unitPrice: 0 })] }, "approve");
    expect(problems.map((p) => p.code)).toContain("ZERO_TOTAL");
  });
});

describe("status transitions", () => {
  it("only a draft is editable", () => {
    expect(isEditable("DRAFT")).toBe(true);
    for (const status of ["APPROVED", "SENT", "PART_PAID", "PAID", "VOID"] as const) {
      expect(isEditable(status)).toBe(false);
    }
  });

  it("follows draft → approved → sent → paid", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "SENT")).toBe(true);
    expect(canTransition("SENT", "PART_PAID")).toBe(true);
    expect(canTransition("PART_PAID", "PAID")).toBe(true);
  });

  it("cannot go backwards or skip to sent from a draft", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(false);
    expect(canTransition("SENT", "APPROVED")).toBe(false);
    expect(canTransition("PAID", "VOID")).toBe(false);
  });

  it("can be voided until it is paid", () => {
    expect(canTransition("DRAFT", "VOID")).toBe(true);
    expect(canTransition("APPROVED", "VOID")).toBe(true);
    expect(canTransition("VOID", "APPROVED")).toBe(false);
  });

  it("explains a refused move", () => {
    expect(() => assertTransition("PAID", "VOID")).toThrow(/final/);
    expect(() => assertTransition("DRAFT", "SENT")).toThrow(/draft invoice cannot become sent/i);
  });
});

describe("invoicePostingLines", () => {
  const DEBTORS = "acc-1100";
  const SALES = "acc-4000";
  const OTHER = "acc-4100";

  it("debits debtors the total and credits sales", () => {
    const lines = invoicePostingLines([{ amount: 25_000, incomeAccountId: null }], DEBTORS, SALES);
    expect(lines).toEqual([
      { accountId: DEBTORS, debit: 25_000, credit: 0 },
      { accountId: SALES, debit: 0, credit: 25_000 },
    ]);
  });

  it("sums lines that share an income account", () => {
    const lines = invoicePostingLines(
      [
        { amount: 25_000, incomeAccountId: null },
        { amount: 10_000, incomeAccountId: null },
        { amount: 5_000, incomeAccountId: OTHER },
      ],
      DEBTORS,
      SALES
    );
    expect(lines).toEqual([
      { accountId: DEBTORS, debit: 40_000, credit: 0 },
      { accountId: SALES, debit: 0, credit: 35_000 },
      { accountId: OTHER, debit: 0, credit: 5_000 },
    ]);
  });

  it("balances whatever the split", () => {
    const lines = invoicePostingLines(
      [
        { amount: 3_333, incomeAccountId: OTHER },
        { amount: 6_667, incomeAccountId: null },
      ],
      DEBTORS,
      SALES
    );
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(10_000);
  });
});
