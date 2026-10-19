import { AccountingError } from "./errors";

/**
 * Ledger dates are calendar days, not instants. They are held as UTC midnight
 * so a posting on 31 March can never slide into April (or back into a locked
 * period) because of a server or browser timezone offset.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" (strictly — 2026-02-30 is rejected) or normalises a Date's UTC day. */
export function toLedgerDate(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new AccountingError("INVALID_DATE", "Invalid date", 400);
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const match = DATE_ONLY_RE.exec(value.trim());
  if (!match) throw new AccountingError("INVALID_DATE", "Dates must be YYYY-MM-DD", 400);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new AccountingError("INVALID_DATE", `${value} is not a real calendar date`, 400);
  }
  return date;
}

/**
 * Today's (or `date`'s) calendar day as "YYYY-MM-DD".
 *
 * Never use `toISOString().slice(0, 10)` for "today": that is the UTC day, and
 * in British Summer Time it is still yesterday until 1am. Without `timeZone`
 * this reads the runtime's local calendar (right in the browser); servers,
 * which usually run on UTC, should pass the business's zone.
 */
export function calendarDateKey(date: Date = new Date(), timeZone?: string): string {
  if (timeZone) {
    // en-CA formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "YYYY-MM-DD" — sorts and compares correctly as a string. */
export function ledgerDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isOnOrBeforeLockDate(date: Date, lockDate: Date | null): boolean {
  return lockDate !== null && ledgerDateKey(date) <= ledgerDateKey(lockDate);
}

/**
 * Financial year start days are capped at 28 so every year has that day —
 * a year starting 29 February would not exist three years in four.
 */
export function isValidYearStart(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 28;
}

/** The financial year (inclusive start and end days) that contains `date`. */
export function financialYearContaining(
  date: Date,
  startMonth: number,
  startDay: number
): { start: Date; end: Date } {
  if (!isValidYearStart(startMonth, startDay)) {
    throw new AccountingError("INVALID_YEAR_START", "Financial year must start on day 1-28 of a month", 400);
  }
  const day = toLedgerDate(date);
  let startYear = day.getUTCFullYear();
  if (day < new Date(Date.UTC(startYear, startMonth - 1, startDay))) startYear -= 1;

  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const nextStart = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay));
  const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
  return { start, end };
}
