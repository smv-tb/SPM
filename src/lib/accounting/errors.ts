export type JournalProblemCode =
  | "INVALID_AMOUNT"
  | "NEGATIVE_AMOUNT"
  | "BOTH_SIDES"
  | "ZERO_LINE"
  | "UNKNOWN_ACCOUNT"
  | "ARCHIVED_ACCOUNT"
  | "TOO_FEW_LINES"
  | "UNBALANCED"
  | "LOCKED_PERIOD";

/** A broken rule, reported per document line where it belongs to one. */
export interface RuleProblem {
  code: string;
  message: string;
  /** 1-based line number, when the problem belongs to one line. */
  line?: number;
}

export interface JournalProblem extends RuleProblem {
  code: JournalProblemCode;
}

/**
 * A rule of the books was broken. Carries an HTTP status so routes can
 * translate it without guessing, and the individual problems so the UI can
 * point at the offending line.
 */
export class AccountingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 422,
    public readonly problems: RuleProblem[] = []
  ) {
    super(message);
    this.name = "AccountingError";
  }
}
