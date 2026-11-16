import { describe, it, expect } from "vitest";
import {
  CARD_PROFILE,
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
  requiredFields,
  resolveColumns,
  type ImportProfile,
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

describe("a credit card statement", () => {
  // One signed amount column, purchases positive, the balance what is owed.
  const CARD = [
    "Date,Description,Amount,Balance",
    "03/10/2026,GITHUB INC,40.00,40.00",
    "05/10/2026,\"PAPER MILL, INV-77\",120.00,160.00",
    "12/10/2026,TRAINLINE REFUND,-15.50,144.50",
    "20/10/2026,PAYMENT RECEIVED - THANK YOU,-144.50,0.00",
  ].join("\n");
  const NO_DETAILS = { sortCode: null, accountNumber: null };
  const spendPositive: ImportProfile = {
    ...CARD_PROFILE,
    columns: { ...CARD_PROFILE.columns, balance: "Balance" },
    amountSign: "OUT_POSITIVE",
    balanceOwed: true,
  };

  function parseCard(profile: ImportProfile, text = CARD) {
    const [header, ...rows] = parseCsv(text, detectDelimiter(text));
    const { index, problems } = resolveColumns(header, profile);
    return { problems, lines: buildLines(rows, index, profile, NO_DETAILS) };
  }

  /** The company card's own export: no balance, newest first, two identical purchases on one day. */
  const ACTIVITY = [
    "Date,Description,Amount",
    "24/10/2026,CARDMEMBERSHIP FEE,195.00",
    "19/10/2026,PAYPAL *STATIONER       01610000000,25.73",
    "14/10/2026,PAYMENT RECEIVED - THANK YOU,-269.40",
    "06/10/2026,PAYPAL *CODEHOST INC    4150000000,44.91",
    "06/10/2026,PAYPAL *CODEHOST INC    4150000000,44.91",
    "25/09/2026,PAYPAL *COURIER UK      03450000000,86.52",
  ].join("\r\n");

  it("reads the company card's export with no set-up", () => {
    const { problems, lines } = parseCard(CARD_PROFILE, ACTIVITY);
    expect(problems).toEqual([]);
    expect(lines.every((l) => l.errors.length === 0 && l.balance === null)).toBe(true);
    const ordered = chronological(lines);
    expect(ordered.map((l) => l.date)).toEqual([
      "2026-09-25", "2026-10-06", "2026-10-06", "2026-10-14", "2026-10-19", "2026-10-24",
    ]);
    // Purchases and the fee are money out; the repayment is money in.
    expect(ordered.map((l) => l.amount)).toEqual([-8652, -4491, -4491, 26940, -2573, -19500]);
    // With no balance to tell them apart, the two identical purchases are the first and second of their kind.
    const keys = fingerprintKeys("card", ordered);
    expect(new Set(keys).size).toBe(6);
    expect(keys[1].endsWith("|occ:1") && keys[2].endsWith("|occ:2")).toBe(true);
  });

  it("will not guess which way round the sign is when nobody has said", () => {
    const { problems } = parseCard({ ...CARD_PROFILE, amountSign: null });
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe("amount");
    expect(problems[0].message).toMatch(/positive amount/);
  });

  it("reads purchases as money out and repayments as money in", () => {
    const { problems, lines } = parseCard(spendPositive);
    expect(problems).toEqual([]);
    expect(lines.map((l) => l.amount)).toEqual([-4000, -12000, 1550, 14450]);
    expect(lines.every((l) => l.errors.length === 0)).toBe(true);
  });

  it("holds what is owed as a negative balance, so each one follows from the last", () => {
    const { lines } = parseCard(spendPositive);
    expect(lines.map((l) => l.balance)).toEqual([-4000, -16000, -14450, 0]);
    expect(checkBalances(lines)).toEqual({ breaks: [], opening: 0, closing: 0 });
  });

  it("reads the same file the other way round when money in is positive", () => {
    const { lines } = parseCard({ ...spendPositive, amountSign: "IN_POSITIVE", balanceOwed: false });
    expect(lines.map((l) => l.amount)).toEqual([4000, 12000, -1550, -14450]);
    expect(lines[0].balance).toBe(4000);
  });

  it("refuses a blank, zero or malformed amount", () => {
    const text = ["Date,Description,Amount", "03/10/2026,A,", "03/10/2026,B,0.00", "03/10/2026,C,12.999"].join("\n");
    const { lines } = parseCard({ ...CARD_PROFILE, amountSign: "OUT_POSITIVE" }, text);
    expect(lines.map((l) => l.errors)).toEqual([["Has no amount"], ["Has no amount"], ['"12.999" is not an amount']]);
    expect(lines.every((l) => l.amount === null)).toBe(true);
  });

  it("refuses one amount column and in/out columns together", () => {
    const header = ["Date", "Description", "Amount", "Debit Amount", "Credit Amount"];
    const both: ImportProfile = {
      ...CARD_PROFILE,
      columns: { ...CARD_PROFILE.columns, debit: "Debit Amount", credit: "Credit Amount" },
      amountSign: "OUT_POSITIVE",
    };
    expect(resolveColumns(header, both).problems.map((p) => p.message)).toEqual([
      "Choose either one amount column or separate money out and money in columns, not both",
    ]);
  });

  it("needs the amount column instead of money in and money out", () => {
    expect(requiredFields(CARD_PROFILE)).toEqual(["date", "description", "amount"]);
    expect(requiredFields(LLOYDS_PROFILE)).toEqual(["date", "description", "debit", "credit"]);
    expect(resolveColumns(["Date", "Description", "Value"], spendPositive).problems.map((p) => p.message)).toEqual([
      'No "Amount" column for amount (one column)',
    ]);
  });

  it("has no account details to check a line against", () => {
    // A bank profile on a card: the sort code column is simply not compared.
    const [header, ...rows] = parseCsv(LLOYDS, ",");
    const { index } = resolveColumns(header, LLOYDS_PROFILE);
    expect(buildLines(rows, index, LLOYDS_PROFILE, NO_DETAILS).every((l) => l.errors.length === 0)).toBe(true);
  });

  it("starts a card from the card layout, and keeps what was saved for it", () => {
    expect(profileFrom(null, CARD_PROFILE)).toEqual(CARD_PROFILE);
    const saved = profileFrom({ columns: { amount: "Value" }, amountSign: "OUT_POSITIVE", balanceOwed: true }, CARD_PROFILE);
    expect(saved.columns.amount).toBe("Value");
    expect(saved.columns.debit).toBeNull();
    expect(saved.amountSign).toBe("OUT_POSITIVE");
    expect(saved.balanceOwed).toBe(true);
    expect(profileFrom({ amountSign: "sideways" }, CARD_PROFILE).amountSign).toBe("OUT_POSITIVE");
    expect(profileFrom({ amountSign: null }, CARD_PROFILE).amountSign).toBeNull();
    // A bank account mapped to one amount column has no default to fall back on.
    expect(profileFrom({ columns: { amount: "Value" } }).amountSign).toBeNull();
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
