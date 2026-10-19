import { sumPence, type Pence } from "@/lib/money";
import type { AccountType } from "./chart";

export interface ReportAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

/** Summed posted movements for one account (from a groupBy over journal lines). */
export interface AccountMovement {
  accountId: string;
  debit: Pence;
  credit: Pence;
}

export interface TrialBalanceRow extends ReportAccount {
  /** Net balance shown on its side: at most one of debit/credit is non-zero. */
  debit: Pence;
  credit: Pence;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: Pence;
  totalCredit: Pence;
  balanced: boolean;
}

/**
 * Each account's net balance in the debit or credit column, ordered by code.
 * Accounts that net to zero are left out unless `includeZero` is set.
 *
 * `balanced` should always be true for posted data — the posting service and
 * a database trigger both refuse unbalanced journals. It is reported rather
 * than assumed so a violation is visible instead of silently "fixed".
 */
export function buildTrialBalance(
  accounts: ReportAccount[],
  movements: AccountMovement[],
  { includeZero = false }: { includeZero?: boolean } = {}
): TrialBalance {
  const byAccount = new Map<string, { debit: Pence; credit: Pence }>();
  for (const m of movements) {
    const current = byAccount.get(m.accountId) ?? { debit: 0, credit: 0 };
    byAccount.set(m.accountId, {
      debit: sumPence([current.debit, m.debit]),
      credit: sumPence([current.credit, m.credit]),
    });
  }

  const known = new Set(accounts.map((a) => a.id));
  for (const id of byAccount.keys()) {
    if (!known.has(id)) throw new Error(`Movement references unknown account ${id}`);
  }

  const rows: TrialBalanceRow[] = [];
  for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const totals = byAccount.get(account.id) ?? { debit: 0, credit: 0 };
    const net = totals.debit - totals.credit;
    if (net === 0 && !includeZero) continue;
    rows.push({ ...account, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }

  const totalDebit = sumPence(rows.map((r) => r.debit));
  const totalCredit = sumPence(rows.map((r) => r.credit));
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}
