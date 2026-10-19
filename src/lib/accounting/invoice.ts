/**
 * Invoice rules as pure functions: numbering, totals and which status change
 * is allowed. The service runs these before writing, and the migration
 * repeats the essential ones (line amount, immutability after approval,
 * number/status coupling) as a backstop.
 */

import { sumPence, type Pence } from "@/lib/money";
import { AccountingError } from "./errors";
import { lineAmountPence, type Milli } from "./sales";

export const INVOICE_STATUSES = [
  "DRAFT",
  "APPROVED",
  "SENT",
  "PART_PAID",
  "PAID",
  "VOID",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  SENT: "Sent",
  PART_PAID: "Part paid",
  PAID: "Paid",
  VOID: "Void",
};

/** Statuses whose document is fixed: corrections are credit notes, not edits. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === "DRAFT";
}

/**
 * Where a status can go next. Payment moves (to PART_PAID/PAID) arrive with
 * allocation in 4.5; they are listed here so the rule lives in one place.
 */
const NEXT_STATUS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["APPROVED", "VOID"],
  APPROVED: ["SENT", "PART_PAID", "PAID", "VOID"],
  SENT: ["PART_PAID", "PAID", "VOID"],
  PART_PAID: ["PAID", "VOID"],
  PAID: [],
  VOID: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return NEXT_STATUS[from].includes(to);
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (canTransition(from, to)) return;
  const done = NEXT_STATUS[from].length === 0;
  throw new AccountingError(
    "INVALID_STATUS",
    done
      ? `A ${INVOICE_STATUS_LABEL[from].toLowerCase()} invoice is final`
      : `A ${INVOICE_STATUS_LABEL[from].toLowerCase()} invoice cannot become ${INVOICE_STATUS_LABEL[to].toLowerCase()}`,
    409
  );
}

/**
 * "INV001". The padding is a minimum, not a limit: number 1000 prints as
 * INV1000 rather than wrapping or truncating.
 */
export function formatInvoiceNumber(prefix: string, sequence: number, pad: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new AccountingError("INVALID_NUMBER", "Invoice numbers start at 1", 422);
  }
  return `${prefix}${String(sequence).padStart(Math.max(1, pad), "0")}`;
}

export interface InvoiceLineInput {
  name: string;
  description?: string | null;
  code?: string | null;
  unit: string;
  quantity: Milli;
  unitPrice: Pence;
  productId?: string | null;
  incomeAccountId?: string | null;
  vatCode?: string | null;
}

export interface InvoiceLineAmounts extends InvoiceLineInput {
  amount: Pence;
}

/** Prices every line, then totals them. No VAT until registration (Phase 7). */
export function priceInvoice(lines: InvoiceLineInput[]): {
  lines: InvoiceLineAmounts[];
  subtotal: Pence;
  total: Pence;
} {
  const priced = lines.map((line) => ({
    ...line,
    amount: lineAmountPence(line.quantity, line.unitPrice),
  }));
  const subtotal = sumPence(priced.map((l) => l.amount));
  return { lines: priced, subtotal, total: subtotal };
}

export interface InvoiceProblem {
  code: string;
  message: string;
  /** 1-based line number, when the problem belongs to one line. */
  line?: number;
}

/**
 * Checks an invoice before it is written. Drafts are work in progress, so
 * only what would corrupt the document is refused; approval additionally
 * needs at least one line and something to charge for.
 */
export function validateInvoice(
  invoice: { lines: InvoiceLineInput[] },
  mode: "draft" | "approve",
  /** Credit notes are priced and checked by the same rules. */
  document: "invoice" | "credit note" = "invoice"
): InvoiceProblem[] {
  const problems: InvoiceProblem[] = [];
  const noun = document === "invoice" ? "An invoice" : "A credit note";

  invoice.lines.forEach((line, i) => {
    const at = i + 1;
    if (line.name.trim().length === 0) {
      problems.push({ code: "LINE_NAME", message: "Every line needs a name", line: at });
    }
    if (line.unit.trim().length === 0) {
      problems.push({ code: "LINE_UNIT", message: "Every line needs a unit", line: at });
    }
    if (line.unitPrice < 0) {
      problems.push({ code: "LINE_PRICE", message: "A price cannot be negative", line: at });
    }
    if (line.quantity <= 0) {
      problems.push({
        code: "LINE_QUANTITY",
        message:
          document === "invoice"
            ? "A quantity must be more than zero; credit a customer with a credit note"
            : "A quantity must be more than zero",
        line: at,
      });
    }
  });

  if (mode === "approve") {
    if (invoice.lines.length === 0) {
      problems.push({ code: "NO_LINES", message: `${noun} needs at least one line` });
    }
    const { total } = priceInvoice(invoice.lines);
    if (total <= 0) {
      problems.push({ code: "ZERO_TOTAL", message: `${noun} must come to more than nothing` });
    }
  }

  return problems;
}

/**
 * The journal an approved invoice posts: debtors owe the total, and each
 * line's income account is credited. Lines sharing an account are summed so
 * the journal reads like a sale, not like a copy of the invoice.
 */
export function invoicePostingLines(
  lines: { amount: Pence; incomeAccountId: string | null }[],
  debtorsAccountId: string,
  defaultIncomeAccountId: string
): { accountId: string; debit: Pence; credit: Pence }[] {
  const byAccount = new Map<string, Pence>();
  for (const line of lines) {
    const accountId = line.incomeAccountId ?? defaultIncomeAccountId;
    byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + line.amount);
  }

  const total = sumPence([...byAccount.values()]);
  return [
    { accountId: debtorsAccountId, debit: total, credit: 0 },
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId,
      debit: 0,
      credit: amount,
    })),
  ];
}
