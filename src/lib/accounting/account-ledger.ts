import { sumPence, type Pence } from "@/lib/money";

/** One posted movement on the account, amounts already in integer pence. */
export interface LedgerMovement {
  debit: Pence;
  credit: Pence;
}

export interface AccountLedgerInput<T extends LedgerMovement> {
  /** Balance before the window starts (everything posted before `from`). */
  openingBalance: Pence;
  /** Totals over EVERY posted line in the window, not just this page. */
  windowDebit: Pence;
  windowCredit: Pence;
  /** Number of lines in the whole window. */
  total: number;
  /** Net (debit − credit) of the window lines that come before this page. */
  carriedIn: Pence;
  /** The page itself, in ledger order. */
  lines: T[];
  offset: number;
  limit: number;
}

export interface AccountLedgerPage<T extends LedgerMovement> {
  openingBalance: Pence;
  /** True balance at the end of the window, whatever page this is. */
  closingBalance: Pence;
  /** Balance the first row of this page starts from. */
  pageOpeningBalance: Pence;
  rows: (T & { balance: Pence })[];
  offset: number;
  limit: number;
  total: number;
  truncated: boolean;
  nextOffset: number | null;
}

/**
 * The closing balance comes from the whole window's totals; the page only
 * decides which rows are shown and where their running balance starts. They
 * were once the same loop, which made the closing balance the balance after
 * the last row *shown* — wrong for any account with more lines than a page.
 */
export function buildAccountLedger<T extends LedgerMovement>(
  input: AccountLedgerInput<T>
): AccountLedgerPage<T> {
  const pageOpeningBalance = sumPence([input.openingBalance, input.carriedIn]);

  let running = pageOpeningBalance;
  const rows = input.lines.map((line) => {
    running = sumPence([running, line.debit, -line.credit]);
    return { ...line, balance: running };
  });

  const end = input.offset + rows.length;
  const truncated = end < input.total;
  return {
    openingBalance: input.openingBalance,
    closingBalance: sumPence([input.openingBalance, input.windowDebit, -input.windowCredit]),
    pageOpeningBalance,
    rows,
    offset: input.offset,
    limit: input.limit,
    total: input.total,
    truncated,
    nextOffset: truncated ? end : null,
  };
}
