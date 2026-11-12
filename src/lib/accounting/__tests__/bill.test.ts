import { describe, it, expect } from "vitest";
import { AccountingError } from "@/lib/accounting/errors";
import {
  assertTransition,
  billLabel,
  billPostingLines,
  billSettledStatus,
  canTransition,
  isBillAccount,
  isEditable,
  priceBill,
  validateBill,
  type BillLineInput,
} from "@/lib/accounting/bill";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toMilli } from "@/lib/accounting/sales";
import { toPence } from "@/lib/money";

function line(overrides: Partial<BillLineInput> = {}): BillLineInput {
  return {
    description: "Cloud hosting, October",
    quantity: toMilli("1"),
    unitPrice: toPence("49.99"),
    accountId: "acc-6400",
    ...overrides,
  };
}

describe("isBillAccount", () => {
  it("takes any expense account", () => {
    expect(isBillAccount({ code: "6400", type: "EXPENSE" })).toBe(true);
    expect(isBillAccount({ code: "5100", type: "EXPENSE" })).toBe(true);
  });

  it("takes assets bought on credit", () => {
    expect(isBillAccount({ code: "1000", type: "ASSET" })).toBe(true); // office equipment
    expect(isBillAccount({ code: "1150", type: "ASSET" })).toBe(true); // prepayments
  });

  it("refuses trade debtors and banks, which have their own documents", () => {
    expect(isBillAccount({ code: "1100", type: "ASSET" })).toBe(false);
    expect(isBillAccount({ code: "1200", type: "ASSET" })).toBe(false);
    expect(isBillAccount({ code: "1210", type: "ASSET" })).toBe(false);
  });

  it("refuses income, liabilities and equity", () => {
    expect(isBillAccount({ code: "4000", type: "INCOME" })).toBe(false);
    expect(isBillAccount({ code: "2100", type: "LIABILITY" })).toBe(false);
    expect(isBillAccount({ code: "3000", type: "EQUITY" })).toBe(false);
  });
});

describe("priceBill", () => {
  it("rounds each line half away from zero, then totals", () => {
    const priced = priceBill([
      line({ quantity: toMilli("2.5"), unitPrice: toPence("0.03") }), // 0.075 → 0.08
      line({ quantity: toMilli("3"), unitPrice: toPence("10.00") }),
    ]);
    expect(priced.lines.map((l) => l.amount)).toEqual([8, 3000]);
    expect(priced.subtotal).toBe(3008);
    expect(priced.total).toBe(3008);
  });
});

describe("validateBill", () => {
  it("lets a draft leave the account empty", () => {
    expect(validateBill({ lines: [line({ accountId: null })] }, "draft")).toEqual([]);
  });

  it("needs an account on every line to approve, and says which", () => {
    const problems = validateBill({ lines: [line(), line({ accountId: null })] }, "approve");
    expect(problems).toEqual([expect.objectContaining({ code: "LINE_ACCOUNT", line: 2 })]);
  });

  it("refuses what would corrupt even a draft", () => {
    const codes = validateBill(
      { lines: [line({ description: "  ", quantity: 0, unitPrice: -1 })] },
      "draft"
    ).map((p) => p.code);
    expect(codes).toEqual(["LINE_DESCRIPTION", "LINE_PRICE", "LINE_QUANTITY"]);
  });

  it("refuses a due date before the bill date", () => {
    const problems = validateBill(
      { lines: [line()], issueDate: toLedgerDate("2026-10-10"), dueDate: toLedgerDate("2026-10-09") },
      "draft"
    );
    expect(problems.map((p) => p.code)).toEqual(["DUE_BEFORE_ISSUE"]);
  });

  it("needs something to pay before approval", () => {
    expect(validateBill({ lines: [] }, "approve").map((p) => p.code)).toEqual(["NO_LINES", "ZERO_TOTAL"]);
    expect(validateBill({ lines: [line({ unitPrice: 0 })] }, "approve").map((p) => p.code)).toEqual([
      "ZERO_TOTAL",
    ]);
  });
});

describe("billPostingLines", () => {
  it("debits each account once and owes the total to creditors", () => {
    const lines = billPostingLines(
      [
        { amount: 1000, accountId: "6400" },
        { amount: 250, accountId: "6300" },
        { amount: 500, accountId: "6400" },
      ],
      "2100"
    );
    expect(lines).toEqual([
      { accountId: "6400", debit: 1500, credit: 0 },
      { accountId: "6300", debit: 250, credit: 0 },
      { accountId: "2100", debit: 0, credit: 1750 },
    ]);
    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBe(credits);
  });
});

describe("status rules", () => {
  it("only a draft is editable", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("APPROVED")).toBe(false);
  });

  it("a draft is approved or deleted, never voided", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(true);
    expect(() => assertTransition("DRAFT", "VOID")).toThrow(/deleted, not voided/);
  });

  it("a void is final", () => {
    expect(canTransition("APPROVED", "VOID")).toBe(true);
    try {
      assertTransition("VOID", "APPROVED");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AccountingError);
      expect((error as AccountingError).status).toBe(409);
    }
  });
});

describe("billLabel", () => {
  it("names the supplier's reference when there is one", () => {
    expect(billLabel({ supplierReference: "INV-4471", supplierName: "Acme Ltd" })).toBe("Bill INV-4471 — Acme Ltd");
    expect(billLabel({ supplierReference: null, supplierName: "Acme Ltd" })).toBe("Bill — Acme Ltd");
  });
});

describe("billSettledStatus", () => {
  it("follows what has been paid", () => {
    expect(billSettledStatus("APPROVED", 10000, 0)).toBe("APPROVED");
    expect(billSettledStatus("APPROVED", 10000, 2500)).toBe("PART_PAID");
    expect(billSettledStatus("PART_PAID", 10000, 10000)).toBe("PAID");
  });

  it("returns to approved when the payments are voided", () => {
    expect(billSettledStatus("PAID", 10000, 0)).toBe("APPROVED");
    expect(billSettledStatus("PAID", 10000, 4000)).toBe("PART_PAID");
  });

  it("never moves a draft or a void", () => {
    expect(billSettledStatus("DRAFT", 10000, 10000)).toBe("DRAFT");
    expect(billSettledStatus("VOID", 10000, 0)).toBe("VOID");
  });
});
