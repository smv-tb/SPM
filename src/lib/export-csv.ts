export type CsvColumn = { key: string; label: string };

/** Rows are joined in slices so a huge export never builds one giant string. */
const CHUNK_SIZE = 5000;

/**
 * Spreadsheet apps evaluate a cell that starts with one of these as a formula,
 * so an exported value like `=HYPERLINK(...)` typed into a task title would run
 * when someone opens the CSV (CSV/formula injection).
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
/** Plain signed numbers are safe and must stay numeric — e.g. "-1250.00". */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function escapeCsvCell(val: unknown): string {
  let str = val == null ? "" : String(val);
  if (FORMULA_TRIGGER.test(str) && !PLAIN_NUMBER.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function resolveColumns(rows: Record<string, unknown>[], columns?: CsvColumn[]): CsvColumn[] {
  return columns ?? Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k }));
}

/** CSV text in slices: header first, then rows, each slice ending in a newline. */
export function toCsvParts(rows: Record<string, unknown>[], columns?: CsvColumn[]): string[] {
  const cols = resolveColumns(rows, columns);
  const parts = [cols.map((c) => escapeCsvCell(c.label)).join(",") + "\n"];

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const body = rows
      .slice(start, start + CHUNK_SIZE)
      .map((row) => cols.map((c) => escapeCsvCell(row[c.key])).join(","))
      .join("\n");
    parts.push(body + "\n");
  }

  return parts;
}

export function downloadCSV(
  rows: Record<string, unknown>[],
  filename: string,
  columns?: CsvColumn[]
) {
  if (rows.length === 0) return;

  // One file, always. Large exports used to be flushed as several downloads,
  // only the first of which had a header row. The BOM makes Excel read the
  // file as UTF-8, so "£" doesn't arrive as "Â£".
  const blob = new Blob(["﻿", ...toCsvParts(rows, columns)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("download", filename);
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
