import { formatPence, sumPence, type Pence } from "@/lib/money";
import { isOnOrBeforeLockDate, ledgerDateKey } from "./dates";
import { AccountingError, type JournalProblem } from "./errors";

/**
 * Journal rules as pure functions. The posting service runs these before
 * writing, and database triggers repeat the essential ones (balance,
 * immutability, lock date) as a backstop.
 */

export interface JournalLineDraft {
  accountId: string;
  debit: Pence;
  credit: Pence;
  description?: string | null;
  projectId?: string | null;
  phaseId?: string | null;
  milestoneId?: string | null;
}

export interface AccountRef {
  id: string;
  code: string;
  name: string;
  isArchived: boolean;
}

export interface JournalValidationContext {
  lockDate: Date | null;
  accounts: ReadonlyMap<string, AccountRef>;
  /**
   * Drafts are work in progress: they may be unbalanced, short of lines, or
   * dated in a locked period (the lock is checked again when posting). Line
   * shape and accounts are still checked so a draft can never hold nonsense.
   */
  mode: "draft" | "post";
}

export function journalTotals(lines: Pick<JournalLineDraft, "debit" | "credit">[]) {
  const debit = sumPence(lines.map((l) => l.debit));
  const credit = sumPence(lines.map((l) => l.credit));
  return { debit, credit, difference: debit - credit };
}

export function validateJournal(
  journal: { date: Date; lines: JournalLineDraft[] },
  ctx: JournalValidationContext
): JournalProblem[] {
  const problems: JournalProblem[] = [];
  const posting = ctx.mode === "post";
  let amountsUsable = true;

  if (posting && isOnOrBeforeLockDate(journal.date, ctx.lockDate)) {
    problems.push({
      code: "LOCKED_PERIOD",
      message: `The books are locked up to ${ledgerDateKey(ctx.lockDate!)}; date the journal after that`,
    });
  }

  if (posting && journal.lines.length < 2) {
    problems.push({ code: "TOO_FEW_LINES", message: "A journal needs at least two lines" });
  }

  journal.lines.forEach((l, i) => {
    const line = i + 1;
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit)) {
      amountsUsable = false;
      problems.push({ code: "INVALID_AMOUNT", message: "Amounts must be whole pence", line });
    } else if (l.debit < 0 || l.credit < 0) {
      amountsUsable = false;
      problems.push({ code: "NEGATIVE_AMOUNT", message: "Amounts cannot be negative — use the other column", line });
    } else if (l.debit > 0 && l.credit > 0) {
      problems.push({ code: "BOTH_SIDES", message: "A line is either a debit or a credit, not both", line });
    } else if (l.debit === 0 && l.credit === 0) {
      problems.push({ code: "ZERO_LINE", message: "Line has no amount", line });
    }

    const account = ctx.accounts.get(l.accountId);
    if (!account) {
      problems.push({ code: "UNKNOWN_ACCOUNT", message: "Account does not exist", line });
    } else if (account.isArchived) {
      problems.push({
        code: "ARCHIVED_ACCOUNT",
        message: `${account.code} ${account.name} is archived`,
        line,
      });
    }
  });

  if (posting && amountsUsable) {
    const { debit, credit } = journalTotals(journal.lines);
    if (debit !== credit) {
      problems.push({
        code: "UNBALANCED",
        message: `Debits (${formatPence(debit)}) must equal credits (${formatPence(credit)})`,
      });
    }
  }

  return problems;
}

/**
 * The number a posting should take.
 *
 * Normally that is the counter, but it must never be a number that already
 * exists: rows can arrive from outside the posting service — an opening-balance
 * import, a data migration, a restored backup — leaving the counter behind the
 * ledger. Taking the highest existing number into account keeps the sequence
 * gapless *and* collision-free; the caller writes the counter back afterwards.
 */
export function allocateJournalNumber(counter: number, highestExisting: number | null): number {
  const next = Math.max(counter, (highestExisting ?? 0) + 1);
  if (!Number.isSafeInteger(next) || next < 1) {
    throw new AccountingError("INVALID_NUMBER", "Journal numbering is out of range", 500);
  }
  return next;
}

/** The mirror image of a journal: every debit becomes a credit and vice versa. */
export function reverseLines<T extends Pick<JournalLineDraft, "debit" | "credit">>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}
