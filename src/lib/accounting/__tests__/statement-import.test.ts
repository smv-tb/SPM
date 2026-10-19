import { describe, it, expect } from "vitest";
import {
  LLOYDS_PROFILE,
  StatementFileError,
  buildLines,
  checkBalances,
  chronological,
  decodeStatement,
  detectDelimiter,
  fingerprintKeys,
  parseCsv,
  parseStatementAmount,
  parseStatementDate,
  profileFrom,
  resolveColumns,
} from "@/lib/accounting/statement-import";

const ACCOUNT = { sortCode: "309950", accountNumber: "12345678" };

/** A Lloyds export as it arrives: newest first, Excel's apostrophe on the sort code. */
const LLOYDS = [
  "Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance",
  "03/10/2026,DEB,'30-99-50,12345678,AMAZON MKTPLACE,12.99,,2487.01",
  "02/10/2026,FPI,'30-99-50,12345678,\"ACME FRANK, INV001\",,1250.00,2500.00",
  "01/10/2026,DD,'30-99-50,12345678,HMRC NDDS,250.00,,1250.00",
].join("\r\n");

function parseLloyds(text = LLOYDS) {
  const [header, ...rows] = parseCsv(text, detectDelimiter(text));
  const { index, problems } = resolveColumns(header, LLOYDS_PROFILE);
  return { problems, lines: buildLines(rows, index, LLOYDS_PROFILE, ACCOUNT) };
}

describe("decodeStatement", () => {
  it("reads UTF-8 and drops the byte-order mark", () => {
    const bytes = new TextEncoder().encode("﻿Date,Amount\n");
    expect(decodeStatement(bytes)).toEqual({ text: "Date,Amount\n", encoding: "utf-8" });
  });

  it("falls back to Windows-1252, where £ is one byte", () => {
    const bytes = new Uint8Array([0xa3, 0x35]); // "£5" as Excel writes it
    expect(decodeStatement(bytes)).toEqual({ text: "£5", encoding: "windows-1252" });
  });

  it("refuses empty, oversized and binary files", () => {
    expect(() => decodeStatement(new Uint8Array())).toThrow(StatementFileError);
    expect(() => decodeStatement(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
    expect(() => decodeStatement(new Uint8Array([0x50, 0x4b, 0x00, 0x03]))).toThrow(/not a text/);
  });
});

describe("parseCsv", () => {
  it("keeps commas, newlines and doubled quotes inside quoted fields", () => {
    expect(parseCsv('a,"b, c","say ""hi""\nthere"\r\nd,e,f', ",")).toEqual([
      ["a", "b, c", 'say "hi"\nthere'],
      ["d", "e", "f"],
    ]);
  });

  it("drops blank lines, including a trailing newline", () => {
    expect(parseCsv("a,b\n\n,\nc,d\n", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("refuses a file that ends inside a quote", () => {
    expect(() => parseCsv('a,"unterminated', ",")).toThrow(/quoted/);
  });

  it("detects tab and semicolon files from the header", () => {
    expect(detectDelimiter("Transaction Date\tTransaction Type\tBalance\n")).toBe("\t");
    expect(detectDelimiter("Datum;Betrag;Saldo")).toBe(";");
    expect(detectDelimiter(LLOYDS)).toBe(",");
  });
});

describe("parseStatementDate", () => {
  it("reads DD/MM/YYYY as the UK writes it", () => {
    expect(parseStatementDate("03/10/2026", "DD/MM/YYYY")).toBe("2026-10-03");
    expect(parseStatementDate("'3/1/2026", "DD/MM/YYYY")).toBe("2026-01-03");
  });

  it("reads the other formats only when chosen", () => {
    expect(parseStatementDate("03/10/2026", "MM/DD/YYYY")).toBe("2026-03-10");
    expect(parseStatementDate("2026-10-03", "YYYY-MM-DD")).toBe("2026-10-03");
    expect(parseStatementDate("2026-10-03", "DD/MM/YYYY")).toBeNull();
  });

  it("refuses days that do not exist", () => {
    expect(parseStatementDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseStatementDate("13/13/2026", "DD/MM/YYYY")).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it("reads UK amounts with or without £ and thousands commas", () => {
    expect(parseStatementAmount("1250.00", "UK")).toBe(125000);
    expect(parseStatementAmount("£1,250.5", "UK")).toBe(125050);
    expect(parseStatementAmount("-£12.99", "UK")).toBe(-1299);
    expect(parseStatementAmount("12", "UK")).toBe(1200);
  });

  it("reads amounts under £1 written without the leading zero, as Lloyds exports them", () => {
    expect(parseStatementAmount(".47", "UK")).toBe(47);
    expect(parseStatementAmount("-.73", "UK")).toBe(-73);
    expect(parseStatementAmount("£.5", "UK")).toBe(50);
    expect(parseStatementAmount(",47", "EU")).toBe(47);
    expect(parseStatementAmount(".", "UK")).toBeUndefined();
    expect(parseStatementAmount(".473", "UK")).toBeUndefined();
  });

  it("reads EU amounts only in EU format", () => {
    expect(parseStatementAmount("1.250,50", "EU")).toBe(125050);
    expect(parseStatementAmount("12,99", "EU")).toBe(1299);
    // The same text means something else in UK format, so it is refused there.
    expect(parseStatementAmount("1.250,50", "UK")).toBeUndefined();
  });

  it("treats blank as no amount and nonsense as invalid", () => {
    expect(parseStatementAmount("  ", "UK")).toBeNull();
    expect(parseStatementAmount("12.999", "UK")).toBeUndefined();
    expect(parseStatementAmount("1,25", "UK")).toBeUndefined();
    expect(parseStatementAmount("abc", "UK")).toBeUndefined();
  });
});

describe("a Lloyds statement", () => {
  it("reads a line with pence-only amounts", () => {
    const pence = LLOYDS.replace("12.99,,2487.01", ".47,,2499.53").replace("1250.00,2500.00", "1250.00,2500.00");
    const [first] = parseLloyds(pence).lines;
    expect(first.errors).toEqual([]);
    expect([first.amount, first.balance]).toEqual([-47, 249953]);
  });

  it("maps every column", () => {
    expect(parseLloyds().problems).toEqual([]);
  });

  it("signs money in positive and money out negative, keeping descriptions intact", () => {
    const { lines } = parseLloyds();
    expect(lines.map((l) => [l.date, l.amount, l.balance, l.errors.length])).toEqual([
      ["2026-10-03", -1299, 248701, 0],
      ["2026-10-02", 125000, 250000, 0],
      ["2026-10-01", -25000, 125000, 0],
    ]);
    expect(lines[1].description).toBe("ACME FRANK, INV001");
    expect(lines[0].type).toBe("DEB");
  });

  it("is put oldest first, and its balances follow", () => {
    const ordered = chronological(parseLloyds().lines);
    expect(ordered.map((l) => l.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(checkBalances(ordered)).toEqual({ breaks: [], opening: 150000, closing: 248701 });
  });

  it("spots a missing line from the running balance", () => {
    const missing = LLOYDS.split("\r\n").filter((l) => !l.includes("ACME")).join("\n");
    const { breaks } = checkBalances(chronological(parseLloyds(missing).lines));
    expect(breaks).toEqual([{ row: 2, expected: 123701, stated: 248701 }]);
  });

  it("flags a line from another account rather than skipping it", () => {
    const other = LLOYDS.replace("'30-99-50,12345678,AMAZON", "'11-22-33,87654321,AMAZON");
    const [first] = parseLloyds(other).lines;
    expect(first.errors).toEqual(["Sort code 112233 is not this account's", "The account number is not this account's"]);
  });

  it("reports bad values on the line they are on", () => {
    const bad = LLOYDS.replace("01/10/2026", "2026-10-01").replace("12.99,,", "12.99,5.00,");
    const lines = parseLloyds(bad).lines;
    expect(lines[0].errors).toEqual(["Has both money in and money out"]);
    expect(lines[2].errors).toEqual(['"2026-10-01" is not a DD/MM/YYYY date']);
  });

  it("names the columns it cannot find", () => {
    const [header] = parseCsv("Date,Details,Amount", ",");
    expect(resolveColumns(header, LLOYDS_PROFILE).problems.map((p) => p.field)).toEqual([
      "date",
      "description",
      "debit",
      "credit",
    ]);
  });
});

describe("chronological", () => {
  const line = (date: string, amount: number, balance: number | null) => ({ date, amount, balance });

  it("keeps an oldest-first file as it is", () => {
    const lines = [line("2026-10-01", 100, 100), line("2026-10-02", 100, 200)];
    expect(chronological(lines)).toEqual(lines);
  });

  it("uses the running balance when every line is on one day", () => {
    const newestFirst = [line("2026-10-01", 50, 250), line("2026-10-01", 100, 200)];
    expect(chronological(newestFirst).map((l) => l.balance)).toEqual([200, 250]);
  });
});

describe("fingerprintKeys", () => {
  it("tells identical same-day lines apart by occurrence when there is no balance", () => {
    const coffee = { date: "2026-10-01", amount: -350, description: "Costa  coffee", balance: null };
    const [a, b] = fingerprintKeys("acct", [coffee, { ...coffee, description: "COSTA COFFEE" }]);
    expect(a).not.toBe(b);
    expect(a.endsWith("occ:1")).toBe(true);
  });

  it("gives the same line the same key in an overlapping export", () => {
    const line = { date: "2026-10-01", amount: -350, description: "COSTA", balance: 1000 };
    expect(fingerprintKeys("acct", [line])).toEqual(fingerprintKeys("acct", [{ ...line, description: " costa " }]));
  });
});

describe("profileFrom", () => {
  it("falls back to Lloyds for anything missing or not understood", () => {
    expect(profileFrom(null)).toEqual(LLOYDS_PROFILE);
    const custom = profileFrom({ dateFormat: "nonsense", numberFormat: "EU", columns: { balance: null } });
    expect(custom.dateFormat).toBe("DD/MM/YYYY");
    expect(custom.numberFormat).toBe("EU");
    expect(custom.columns.balance).toBeNull();
    expect(custom.columns.date).toBe("Transaction Date");
  });
});
