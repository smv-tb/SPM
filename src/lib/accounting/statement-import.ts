/**
 * Reading a bank statement file, as pure functions: decode the bytes, split
 * the CSV, map columns, parse dates and amounts by an explicit format, put
 * the lines in date order and check them against the bank's running balance.
 *
 * Nothing here guesses silently. A date format and a number format are part
 * of the import profile, chosen once per bank account; a value that does not
 * fit them is an error on that line, shown in the preview, not a best effort.
 *
 * No database and no Node built-ins, so the rules are unit-tested directly;
 * statements.ts does the writing.
 */

import type { Pence } from "@/lib/money";

// ── Profiles ────────────────────────────────────────────────────────────────

export const STATEMENT_FIELDS = [
  "date",
  "type",
  "sortCode",
  "accountNumber",
  "description",
  "debit",
  "credit",
  "balance",
] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];

/** Fields a statement must have; the rest are used when present. */
export const REQUIRED_FIELDS: readonly StatementField[] = ["date", "description", "debit", "credit"];

export const FIELD_LABEL: Record<StatementField, string> = {
  date: "Date",
  type: "Transaction type",
  sortCode: "Sort code",
  accountNumber: "Account number",
  description: "Description",
  debit: "Money out",
  credit: "Money in",
  balance: "Balance",
};

export const DATE_FORMATS = ["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** UK writes 1,234.56; much of the EU writes 1.234,56. Never inferred. */
export const NUMBER_FORMATS = ["UK", "EU"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export interface ImportProfile {
  /** Header name for each field; null when the file has no such column. */
  columns: Partial<Record<StatementField, string | null>>;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
}

/** Lloyds' statement export, as the business's own file headers it. */
export const LLOYDS_PROFILE: ImportProfile = {
  columns: {
    date: "Transaction Date",
    type: "Transaction Type",
    sortCode: "Sort Code",
    accountNumber: "Account Number",
    description: "Transaction Description",
    debit: "Debit Amount",
    credit: "Credit Amount",
    balance: "Balance",
  },
  dateFormat: "DD/MM/YYYY",
  numberFormat: "UK",
};

/** Reads a stored profile, falling back to Lloyds for anything missing or malformed. */
export function profileFrom(stored: unknown): ImportProfile {
  const value = (stored ?? {}) as Partial<ImportProfile>;
  return {
    columns: { ...LLOYDS_PROFILE.columns, ...(typeof value.columns === "object" ? value.columns : {}) },
    dateFormat: DATE_FORMATS.includes(value.dateFormat as DateFormat)
      ? (value.dateFormat as DateFormat)
      : LLOYDS_PROFILE.dateFormat,
    numberFormat: NUMBER_FORMATS.includes(value.numberFormat as NumberFormat)
      ? (value.numberFormat as NumberFormat)
      : LLOYDS_PROFILE.numberFormat,
  };
}

// ── Bytes and CSV ───────────────────────────────────────────────────────────

export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
export const MAX_STATEMENT_LINES = 20_000;

export class StatementFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementFileError";
  }
}

/**
 * Text from the uploaded bytes: UTF-8 (BOM stripped) when the bytes are
 * valid UTF-8, otherwise Windows-1252 — what Excel writes, and where "£" is a
 * single byte that UTF-8 would reject. A file with NUL bytes is not text.
 */
export function decodeStatement(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  if (bytes.length === 0) throw new StatementFileError("The file is empty");
  if (bytes.length > MAX_STATEMENT_BYTES) throw new StatementFileError("The file is larger than 5 MB");
  if (bytes.includes(0)) throw new StatementFileError("That is not a text (CSV) file");
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return { text, encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/** Comma, tab or semicolon: whichever splits the header line most. */
export function detectDelimiter(text: string): "," | "\t" | ";" {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = ([",", "\t", ";"] as const).map((d) => [d, header.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}

/**
 * RFC 4180 CSV: quoted fields may hold the delimiter, newlines and doubled
 * quotes. Blank lines are dropped. Every cell is returned as written.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
    cell = "";
  };

  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += char;
      i++;
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      endRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else {
      cell += char;
    }
    i++;
  }
  if (quoted) throw new StatementFileError("The file ends inside a quoted value");
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

// ── Values ──────────────────────────────────────────────────────────────────

/** Excel prefixes text that looks numeric with an apostrophe: `'30-99-50`. */
function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/^'/, "").trim();
}

/** A calendar date in the given format, as "YYYY-MM-DD", or null if it is not one. */
export function parseStatementDate(value: string, format: DateFormat): string | null {
  const v = clean(value);
  let day: number, month: number, year: number;
  let m: RegExpExecArray | null;
  if (format === "YYYY-MM-DD") {
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
    if (!m) return null;
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!m) return null;
    [day, month, year] =
      format === "DD/MM/YYYY" ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[2]), Number(m[1]), Number(m[3])];
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null; // 31/02 and friends
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * An amount in the given number format to pence. Blank is null (no amount in
 * that column). "£", spaces and thousands separators are accepted only where
 * they belong to the chosen format; anything else is undefined (invalid).
 */
export function parseStatementAmount(value: string, format: NumberFormat): Pence | null | undefined {
  let v = clean(value).replace(/^£\s*/, "").replace(/^(-)£\s*/, "$1").replace(/\s/g, "");
  if (v === "") return null;
  // Lloyds drops the leading zero on amounts under £1: ".47", "-.73".
  v = format === "UK" ? v.replace(/^(-?)\.(?=\d)/, "$10.") : v.replace(/^(-?),(?=\d)/, "$10,");
  if (format === "UK") {
    if (!/^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^-?\d+(\.\d{1,2})?$/.test(v)) return undefined;
    v = v.replace(/,/g, "");
  } else {
    if (!/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(v)) return undefined;
    v = v.replace(/\./g, "").replace(",", ".");
  }
  const negative = v.startsWith("-");
  const [whole, fraction = ""] = v.replace("-", "").split(".");
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence)) return undefined;
  return negative ? -pence : pence;
}

export function normaliseSortCode(value: string): string {
  return clean(value).replace(/[\s-]/g, "");
}

export function normaliseAccountNumber(value: string): string {
  return clean(value).replace(/\s/g, "");
}

/** The description as compared for duplicates: case and spacing do not count. */
export function normaliseDescription(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

// ── Lines ───────────────────────────────────────────────────────────────────

export interface ParsedLine {
  /** 1-based row in the file, counting the header as row 1. */
  row: number;
  date: string | null;
  type: string | null;
  description: string;
  /** Signed: money in positive, money out negative. */
  amount: Pence | null;
  balance: Pence | null;
  errors: string[];
}

export interface ColumnProblem {
  field: StatementField;
  message: string;
}

/** Which header each field maps to, checking the required ones exist. */
export function resolveColumns(
  header: string[],
  profile: ImportProfile
): { index: Partial<Record<StatementField, number>>; problems: ColumnProblem[] } {
  const trimmed = header.map((h) => h.replace(/^﻿/, "").trim().toLowerCase());
  const index: Partial<Record<StatementField, number>> = {};
  const problems: ColumnProblem[] = [];
  for (const field of STATEMENT_FIELDS) {
    const name = profile.columns[field];
    if (!name) continue;
    const at = trimmed.indexOf(name.trim().toLowerCase());
    if (at >= 0) index[field] = at;
    else if (REQUIRED_FIELDS.includes(field)) {
      problems.push({ field, message: `No "${name}" column for ${FIELD_LABEL[field].toLowerCase()}` });
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (!profile.columns[field]) problems.push({ field, message: `Choose a column for ${FIELD_LABEL[field].toLowerCase()}` });
  }
  return { index, problems };
}

/**
 * Turns data rows into statement lines, each with its own errors. A row for
 * a different account is an error, not a skip: importing the wrong file
 * should be loud.
 */
export function buildLines(
  rows: string[][],
  index: Partial<Record<StatementField, number>>,
  profile: ImportProfile,
  account: { sortCode: string; accountNumber: string }
): ParsedLine[] {
  if (rows.length > MAX_STATEMENT_LINES) {
    throw new StatementFileError(`The file has more than ${MAX_STATEMENT_LINES.toLocaleString("en-GB")} lines`);
  }
  const cell = (row: string[], field: StatementField) => (index[field] === undefined ? "" : row[index[field]!] ?? "");

  return rows.map((row, i) => {
    const errors: string[] = [];
    const rawDate = cell(row, "date");
    const date = parseStatementDate(rawDate, profile.dateFormat);
    if (!date) errors.push(`"${clean(rawDate)}" is not a ${profile.dateFormat} date`);

    const debit = parseStatementAmount(cell(row, "debit"), profile.numberFormat);
    const credit = parseStatementAmount(cell(row, "credit"), profile.numberFormat);
    if (debit === undefined) errors.push(`"${clean(cell(row, "debit"))}" is not an amount`);
    if (credit === undefined) errors.push(`"${clean(cell(row, "credit"))}" is not an amount`);

    let amount: Pence | null = null;
    if (debit !== undefined && credit !== undefined) {
      const out = debit ?? 0;
      const into = credit ?? 0;
      if (out !== 0 && into !== 0) errors.push("Has both money in and money out");
      else if (out === 0 && into === 0) errors.push("Has no amount");
      else if (out < 0 || into < 0) errors.push("Amounts in the in/out columns should not be negative");
      else amount = into > 0 ? into : -out;
    }

    let balance: Pence | null = null;
    if (index.balance !== undefined) {
      const parsed = parseStatementAmount(cell(row, "balance"), profile.numberFormat);
      if (parsed === undefined) errors.push(`"${clean(cell(row, "balance"))}" is not a balance`);
      else balance = parsed;
    }

    if (index.sortCode !== undefined) {
      const sortCode = normaliseSortCode(cell(row, "sortCode"));
      if (sortCode && sortCode !== account.sortCode) errors.push(`Sort code ${sortCode} is not this account's`);
    }
    if (index.accountNumber !== undefined) {
      const number = normaliseAccountNumber(cell(row, "accountNumber"));
      if (number && number !== account.accountNumber) errors.push("The account number is not this account's");
    }

    const description = cell(row, "description").trim();
    if (!description) errors.push("Has no description");
    const type = clean(cell(row, "type")) || null;

    return { row: i + 2, date, type, description, amount, balance, errors };
  });
}

/**
 * Oldest first. Lloyds lists newest first, other banks oldest first; the
 * file's own order is kept within a day (reversed with it), which is the only
 * evidence of the order the bank applied same-day lines in. When the first and
 * last dates tie, the running balance decides.
 */
export function chronological<T extends { date: string | null; amount: Pence | null; balance: Pence | null }>(
  lines: T[]
): T[] {
  const dated = lines.filter((l) => l.date);
  if (dated.length < 2) return [...lines];
  const first = dated[0].date!;
  const last = dated[dated.length - 1].date!;
  let newestFirst = first > last;
  if (first === last) {
    // In file order, does each balance follow from the previous one?
    const followsForward = lines.every(
      (l, i) =>
        i === 0 || l.balance === null || lines[i - 1].balance === null || l.amount === null ||
        lines[i - 1].balance! + l.amount === l.balance
    );
    newestFirst = !followsForward;
  }
  return newestFirst ? [...lines].reverse() : [...lines];
}

export interface BalanceBreak {
  row: number;
  expected: Pence;
  stated: Pence;
}

/**
 * Checks each line against the bank's running balance: the previous balance
 * plus this line's amount must equal the balance printed on it. A break means
 * a missing, extra or altered line between the two.
 */
export function checkBalances(
  lines: { row: number; amount: Pence | null; balance: Pence | null }[]
): { breaks: BalanceBreak[]; opening: Pence | null; closing: Pence | null } {
  const breaks: BalanceBreak[] = [];
  let previous: Pence | null = null;
  let opening: Pence | null = null;
  let closing: Pence | null = null;
  for (const line of lines) {
    if (line.amount === null || line.balance === null) {
      previous = null;
      continue;
    }
    if (opening === null && closing === null) opening = line.balance - line.amount;
    if (previous !== null && previous + line.amount !== line.balance) {
      breaks.push({ row: line.row, expected: previous + line.amount, stated: line.balance });
    }
    previous = line.balance;
    closing = line.balance;
  }
  return { breaks, opening, closing };
}

/**
 * The identity of a line for duplicate detection, before hashing. With a
 * running balance the line is unique on its own; without one, identical lines
 * on the same day are told apart by their occurrence within the file.
 */
export function fingerprintKeys(
  bankAccountId: string,
  lines: { date: string | null; amount: Pence | null; description: string; balance: Pence | null }[]
): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = [bankAccountId, line.date, line.amount, normaliseDescription(line.description)].join("|");
    if (line.balance !== null) return `${base}|bal:${line.balance}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return `${base}|occ:${occurrence}`;
  });
}
