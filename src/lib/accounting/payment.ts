/**
 * Customer payment rules as pure functions: the journals a receipt and a
 * refund post, which accounts money can move through, and when an allocation
 * may be dated. The services run these; the migration repeats the essentials.
 */

import type { Pence } from "@/lib/money";
import { AccountingError } from "./errors";
import { ledgerDateKey } from "./dates";

export const PAYMENT_KIND_LABEL = { RECEIPT: "Payment received", REFUND: "Refund" } as const;
export type PaymentKind = keyof typeof PAYMENT_KIND_LABEL;

/** Bank accounts are the 12xx asset codes: 1200 business account, 1210 savings… */
export function isBankAccountCode(code: string): boolean {
  return /^12\d\d$/.test(code);
}

type PostingLine = { accountId: string; debit: Pence; credit: Pence };

/** Money in: the bank goes up, and the customer owes that much less. */
export function receiptPostingLines(amount: Pence, bankAccountId: string, debtorsAccountId: string): PostingLine[] {
  assertPositive(amount);
  return [
    { accountId: bankAccountId, debit: amount, credit: 0 },
    { accountId: debtorsAccountId, debit: 0, credit: amount },
  ];
}

/** Credit paid back: the bank goes down, and the customer's credit balance with it. */
export function refundPostingLines(amount: Pence, bankAccountId: string, debtorsAccountId: string): PostingLine[] {
  assertPositive(amount);
  return [
    { accountId: debtorsAccountId, debit: amount, credit: 0 },
    { accountId: bankAccountId, debit: 0, credit: amount },
  ];
}

function assertPositive(amount: Pence): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AccountingError("INVALID_AMOUNT", "A payment must be more than zero", 422);
  }
}

/**
 * An allocation cannot be dated before either document it links exists:
 * the aged debtors report reads allocations by date, and a settlement dated
 * before its invoice would make the invoice look paid before it was raised.
 */
export function assertAllocationDate(date: Date, documentDates: Date[]): void {
  const day = ledgerDateKey(date);
  const latest = documentDates.map(ledgerDateKey).sort().at(-1);
  if (latest && day < latest) {
    throw new AccountingError(
      "ALLOCATION_TOO_EARLY",
      `An allocation cannot be dated before ${latest}, when the later of the two documents was dated`,
      422
    );
  }
}
