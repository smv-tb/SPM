import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "./dates";
import { AccountingError } from "./errors";

/**
 * The dates a statement is asked for: `asAt` (default today, the business's
 * day) and an optional `compare` for a second column. Bad dates are an error,
 * not a quiet fallback.
 */
export function reportDates(params: URLSearchParams): { asAt: Date; compare: Date | null } {
  const asAt = toLedgerDate(params.get("asAt") || calendarDateKey(new Date(), BUSINESS_TIME_ZONE));
  const compare = params.get("compare") ? toLedgerDate(params.get("compare")!) : null;
  return { asAt, compare };
}

export interface PeriodRequest {
  from: Date;
  to: Date;
  compare: { from: Date; to: Date } | null;
  projectId: string | null;
  phaseId: string | null;
}

/**
 * The period a profit and loss is asked for: `from`/`to` (default the
 * financial year containing today, up to today), an optional comparative
 * `compareFrom`/`compareTo` (both or neither), and optional project / phase
 * filters. Bad or back-to-front dates are an error, not a quiet fallback.
 */
export function periodRequest(
  params: URLSearchParams,
  year: { start: Date },
  today = calendarDateKey(new Date(), BUSINESS_TIME_ZONE)
): PeriodRequest {
  const from = params.get("from") ? toLedgerDate(params.get("from")!) : year.start;
  const to = toLedgerDate(params.get("to") || today);
  if (from > to) throw new AccountingError("INVALID_PERIOD", "The period starts after it ends", 400);

  const cf = params.get("compareFrom");
  const ct = params.get("compareTo");
  if (Boolean(cf) !== Boolean(ct)) {
    throw new AccountingError("INVALID_PERIOD", "A comparative period needs both a start and an end", 400);
  }
  const compare = cf && ct ? { from: toLedgerDate(cf), to: toLedgerDate(ct) } : null;
  if (compare && compare.from > compare.to) {
    throw new AccountingError("INVALID_PERIOD", "The comparative period starts after it ends", 400);
  }
  return { from, to, compare, projectId: params.get("projectId") || null, phaseId: params.get("phaseId") || null };
}
