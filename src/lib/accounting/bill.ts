/**
 * Bill rules as pure functions: pricing, which accounts a line may debit, the
 * posting split and which status change is allowed. The service runs these
 * before writing, and the `_add_bills` migration repeats the essential ones
 * (line amount, account eligibility, immutability after approval) as a
 * backstop. Prisma-free so the bill form prices exactly as the server posts.
 */

import { sumPence, type Pence } from "@/lib/money";
import { AccountingError, type RuleProblem } from "./errors";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { lineAmountPence, type Milli } from "./sales";

export const BILL_STATUSES = ["DRAFT", "APPROVED", "PART_PAID", "PAID", "VOID"] as const;

export type BillStatus = (typeof BILL_STATUSES)[number];

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  PART_PAID: "Part paid",
  PAID: "Paid",
  VOID: "Void",
};

/** Bills we still owe something on. */
export const OPEN_BILL_STATUSES: readonly BillStatus[] = ["APPROVED", "PART_PAID"];

export function isEditable(status: BillStatus): boolean {
  return status === "DRAFT";
}

/**
 * Where a status can go next. Drafts are deleted rather than voided — they
 * never reached the books. Payment moves arrive with supplier payments (5.2);
 * they are listed here so the rule lives in one place.
 */
const NEXT_STATUS: Record<BillStatus, readonly BillStatus[]> = {
  DRAFT: ["APPROVED"],
  APPROVED: ["PART_PAID", "PAID", "VOID"],
  PART_PAID: ["APPROVED", "PAID", "VOID"],
  PAID: ["APPROVED", "PART_PAID"],
  VOID: [],
};

export function canTransition(from: BillStatus, to: BillStatus): boolean {
  return NEXT_STATUS[from].includes(to);
}

export function assertTransition(from: BillStatus, to: BillStatus): void {
  if (canTransition(from, to)) return;
  if (from === "DRAFT" && to === "VOID") {
    throw new AccountingError("INVALID_STATUS", "A draft bill is deleted, not voided", 409);
  }
  const done = NEXT_STATUS[from].length === 0;
  throw new AccountingError(
    "INVALID_STATUS",
    done
      ? `A ${BILL_STATUS_LABEL[from].toLowerCase()} bill is final`
      : `A ${BILL_STATUS_LABEL[from].toLowerCase()} bill cannot become ${BILL_STATUS_LABEL[to].toLowerCase()}`,
    409
  );
}

/**
 * What a bill line may debit: any expense, or an asset bought on credit —
 * fixed assets, prepayments, other debtors. Never trade debtors (customers
 * go through invoices) or a 12xx bank account (money moving is a payment, not
 * a bill). The `bill_lines_account_guard` trigger applies the same test.
 */
export function isBillAccount(account: { code: string; type: string }): boolean {
  if (account.type === "EXPENSE") return true;
  if (account.type !== "ASSET") return false;
  return account.code !== SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS && !account.code.startsWith("12");
}

export interface BillLineInput {
  description: string;
  quantity: Milli;
  unitPrice: Pence;
  accountId?: string | null;
  vatCode?: string | null;
}

export interface BillLineAmounts extends BillLineInput {
  amount: Pence;
}

/** Prices every line, then totals them. No VAT until registration (Phase 7). */
export function priceBill(lines: BillLineInput[]): {
  lines: BillLineAmounts[];
  subtotal: Pence;
  total: Pence;
} {
  const priced = lines.map((line) => ({ ...line, amount: lineAmountPence(line.quantity, line.unitPrice) }));
  const subtotal = sumPence(priced.map((l) => l.amount));
  return { lines: priced, subtotal, total: subtotal };
}

/**
 * Checks a bill before it is written. A draft is work in progress, so only
 * what would corrupt it is refused; approval also needs a line, something to
 * pay and an account on every line.
 */
export function validateBill(
  bill: { lines: BillLineInput[]; issueDate?: Date; dueDate?: Date },
  mode: "draft" | "approve"
): RuleProblem[] {
  const problems: RuleProblem[] = [];

  if (bill.issueDate && bill.dueDate && bill.dueDate.getTime() < bill.issueDate.getTime()) {
    problems.push({ code: "DUE_BEFORE_ISSUE", message: "The due date cannot be before the bill date" });
  }

  bill.lines.forEach((line, i) => {
    const at = i + 1;
    if (line.description.trim().length === 0) {
      problems.push({ code: "LINE_DESCRIPTION", message: "Every line needs a description", line: at });
    }
    if (line.unitPrice < 0) {
      problems.push({ code: "LINE_PRICE", message: "A price cannot be negative", line: at });
    }
    if (line.quantity <= 0) {
      problems.push({ code: "LINE_QUANTITY", message: "A quantity must be more than zero", line: at });
    }
    if (mode === "approve" && !line.accountId) {
      problems.push({ code: "LINE_ACCOUNT", message: "Choose the account this line is booked to", line: at });
    }
  });

  if (mode === "approve") {
    if (bill.lines.length === 0) {
      problems.push({ code: "NO_LINES", message: "A bill needs at least one line" });
    }
    if (priceBill(bill.lines).total <= 0) {
      problems.push({ code: "ZERO_TOTAL", message: "A bill must come to more than nothing" });
    }
  }

  return problems;
}

/**
 * The journal an approved bill posts: each line's account is debited and
 * trade creditors is owed the total. Lines sharing an account are summed so
 * the journal reads like a purchase, not like a copy of the bill.
 */
export function billPostingLines(
  lines: { amount: Pence; accountId: string }[],
  creditorsAccountId: string
): { accountId: string; debit: Pence; credit: Pence }[] {
  const byAccount = new Map<string, Pence>();
  for (const line of lines) {
    byAccount.set(line.accountId, (byAccount.get(line.accountId) ?? 0) + line.amount);
  }

  const total = sumPence([...byAccount.values()]);
  return [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({ accountId, debit: amount, credit: 0 })),
    { accountId: creditorsAccountId, debit: 0, credit: total },
  ];
}

/** "Bill INV-4471 — Acme Ltd", or without a reference "Bill — Acme Ltd". */
export function billLabel(bill: { supplierReference: string | null; supplierName: string }): string {
  return bill.supplierReference
    ? `Bill ${bill.supplierReference} — ${bill.supplierName}`
    : `Bill — ${bill.supplierName}`;
}
