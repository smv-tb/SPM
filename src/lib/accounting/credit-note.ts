/**
 * Credit note rules as pure functions. A credit note is priced exactly like
 * an invoice (`priceInvoice`, `validateInvoice`); what differs is the
 * direction of its journal and how its value settles invoices.
 */

import { sumPence, type Pence } from "@/lib/money";
import { AccountingError } from "./errors";
import { invoicePostingLines, type InvoiceStatus } from "./invoice";

export const CREDIT_NOTE_STATUSES = ["DRAFT", "APPROVED", "VOID"] as const;

export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

export const CREDIT_NOTE_STATUS_LABEL: Record<CreditNoteStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  VOID: "Void",
};

const NEXT_STATUS: Record<CreditNoteStatus, readonly CreditNoteStatus[]> = {
  DRAFT: ["APPROVED", "VOID"],
  APPROVED: ["VOID"],
  VOID: [],
};

export function assertCreditNoteTransition(from: CreditNoteStatus, to: CreditNoteStatus): void {
  if (NEXT_STATUS[from].includes(to)) return;
  throw new AccountingError(
    "INVALID_STATUS",
    NEXT_STATUS[from].length === 0
      ? `A ${CREDIT_NOTE_STATUS_LABEL[from].toLowerCase()} credit note is final`
      : `A ${CREDIT_NOTE_STATUS_LABEL[from].toLowerCase()} credit note cannot become ${CREDIT_NOTE_STATUS_LABEL[to].toLowerCase()}`,
    409
  );
}

/**
 * The journal an approved credit note posts: the invoice's journal the other
 * way round. Each income account is debited (the sale is taken back) and
 * trade debtors is credited (the customer owes that much less).
 */
export function creditNotePostingLines(
  lines: { amount: Pence; incomeAccountId: string | null }[],
  debtorsAccountId: string,
  defaultIncomeAccountId: string
): { accountId: string; debit: Pence; credit: Pence }[] {
  return invoicePostingLines(lines, debtorsAccountId, defaultIncomeAccountId).map((line) => ({
    accountId: line.accountId,
    debit: line.credit,
    credit: line.debit,
  }));
}

/**
 * Where an invoice stands once credits (and, from 4.5, payments) are applied.
 * Fully settled is PAID and partly settled is PART_PAID — the convention the
 * common bookkeeping tools use for a credited invoice — and an invoice whose
 * settlement is removed goes back to SENT or APPROVED, whichever it was.
 *
 * Drafts and voids are not settleable; they are returned unchanged.
 */
export function settledStatus(
  current: InvoiceStatus,
  total: Pence,
  settled: Pence,
  sentAt: Date | string | null
): InvoiceStatus {
  if (current === "DRAFT" || current === "VOID") return current;
  if (settled >= total) return "PAID";
  if (settled > 0) return "PART_PAID";
  return sentAt ? "SENT" : "APPROVED";
}

/** What is still owed on an invoice after what has been applied to it. */
export function amountDue(total: Pence, applied: Pence[]): Pence {
  return Math.max(0, total - sumPence(applied));
}

/**
 * How much of a credit note to apply to an invoice: as much as the request
 * asks for, but never more than the credit has left or the invoice still
 * owes. Refuses rather than silently trimming an explicit amount.
 */
export function allocationAmount(options: {
  requested?: Pence;
  creditRemaining: Pence;
  invoiceDue: Pence;
  /** What the money comes from, for the refusal: "the credit note", "the payment". */
  source?: string;
}): Pence {
  const { requested, creditRemaining, invoiceDue, source = "the credit note" } = options;
  const most = Math.min(creditRemaining, invoiceDue);
  if (requested === undefined) return most;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new AccountingError("INVALID_AMOUNT", "Allocate an amount more than zero", 422);
  }
  if (requested > creditRemaining) {
    throw new AccountingError(
      "OVER_ALLOCATED",
      `That is more than ${source} has left to allocate`,
      422
    );
  }
  if (requested > invoiceDue) {
    throw new AccountingError("OVER_ALLOCATED", "That is more than the invoice still owes", 422);
  }
  return requested;
}
