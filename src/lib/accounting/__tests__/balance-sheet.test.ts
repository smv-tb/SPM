import { describe, it, expect } from "vitest";
import { balanceSheetRows, buildBalanceSheet, groupFor, profit } from "@/lib/accounting/balance-sheet";
import type { AccountMovement, ReportAccount } from "@/lib/accounting/trial-balance";

const acct = (code: string, name: string, type: ReportAccount["type"]): ReportAccount => ({ id: code, code, name, type });
const ACCOUNTS = [
  acct("1000", "Office equipment", "ASSET"),
  acct("1100", "Trade debtors", "ASSET"),
  acct("1200", "Business bank account", "ASSET"),
  acct("1210", "Savings account", "ASSET"),
  acct("2100", "Trade creditors", "LIABILITY"),
  acct("2300", "Loans", "LIABILITY"),
  acct("3000", "Share capital", "EQUITY"),
  acct("4000", "Sales", "INCOME"),
  acct("6700", "Bank charges", "EXPENSE"),
];

/** Movements as journals would leave them: each pair balances. */
function post(entries: [string, string, number][]): AccountMovement[] {
  const map = new Map<string, AccountMovement>();
  for (const [dr, cr, amount] of entries) {
    const d = map.get(dr) ?? { accountId: dr, debit: 0, credit: 0 };
    d.debit += amount;
    map.set(dr, d);
    const c = map.get(cr) ?? { accountId: cr, debit: 0, credit: 0 };
    c.credit += amount;
    map.set(cr, c);
  }
  return [...map.values()];
}

const lastYear: [string, string, number][] = [
  ["1200", "3000", 100], // shares issued for £1
  ["1100", "4000", 125000], // a sale on credit
  ["1200", "1100", 100000], // most of it paid
];
const thisYear: [string, string, number][] = [
  ["1000", "2300", 300000], // equipment on a loan
  ["6700", "1200", 750], // bank charges
  ["1100", "4000", 50000],
];

function sheet() {
  return buildBalanceSheet({
    asAt: "2026-10-31",
    yearStart: "2025-11-01",
    accounts: ACCOUNTS,
    toDate: post([...lastYear, ...thisYear]),
    beforeYear: post(lastYear),
    details: { "1100": [{ key: "c1", label: "Acme Frank", amount: 75000 }] },
  });
}

describe("groupFor", () => {
  it("files accounts as the old report did", () => {
    expect(groupFor("ASSET", "1200")).toEqual({ section: "assets", group: "bank" });
    expect(groupFor("ASSET", "1100")).toEqual({ section: "assets", group: "debtors" });
    expect(groupFor("ASSET", "1150")).toEqual({ section: "assets", group: "otherCurrent" });
    expect(groupFor("ASSET", "1010")).toEqual({ section: "assets", group: "fixed" });
    expect(groupFor("LIABILITY", "2300")).toEqual({ section: "liabilities", group: "loans" });
    expect(groupFor("LIABILITY", "2400")).toEqual({ section: "liabilities", group: "current" });
    expect(groupFor("INCOME", "4000")).toBeNull();
  });
});

describe("buildBalanceSheet", () => {
  it("balances whenever the books do", () => {
    const s = sheet();
    expect(s.balanced).toBe(true);
    expect(s.totalAssets).toBe(s.totalLiabilitiesAndEquity);
  });

  it("puts each balance on its natural side", () => {
    const s = sheet();
    const line = (code: string) => s.sections.flatMap((x) => x.groups.flatMap((g) => g.lines)).find((l) => l.code === code)!;
    expect(line("1200").amount).toBe(100 + 100000 - 750);
    expect(line("1100").amount).toBe(75000);
    expect(line("2300").amount).toBe(300000);
    expect(line("3000").amount).toBe(100);
  });

  it("splits unclosed profit into brought forward and the year so far", () => {
    const earnings = sheet().sections[2].groups.find((g) => g.key === "earnings")!.lines;
    expect(earnings.map((l) => l.amount)).toEqual([125000, 50000 - 750]);
    expect(earnings[1].label).toBe("Profit or loss for the year");
  });

  it("works out profit as income less expenses", () => {
    expect(profit(ACCOUNTS, post([["1200", "4000", 1000], ["6700", "1200", 300]]))).toBe(700);
  });
});

describe("balanceSheetRows", () => {
  it("leaves out lines and groups that are zero everywhere", () => {
    const rows = balanceSheetRows([sheet()]);
    expect(rows.find((r) => r.code === "1210")).toBeUndefined(); // savings: never used
    expect(rows.find((r) => r.label === "Trade creditors")).toBeUndefined();
    expect(rows.find((r) => r.label === "Current liabilities")).toBeUndefined();
    expect(balanceSheetRows([sheet()], { includeZero: true }).find((r) => r.code === "1210")).toBeDefined();
  });

  it("prints the debtors breakdown under its line", () => {
    const rows = balanceSheetRows([sheet()]);
    const at = rows.findIndex((r) => r.code === "1100");
    expect(rows[at + 1]).toEqual({ kind: "detail", label: "Acme Frank", code: null, amounts: [75000] });
  });

  it("ends with the two totals that must agree", () => {
    const rows = balanceSheetRows([sheet()]);
    const assets = rows.find((r) => r.label === "Total assets")!;
    const grand = rows.at(-1)!;
    expect(grand.kind).toBe("grandTotal");
    expect(grand.amounts).toEqual(assets.amounts);
  });

  it("lines a comparative date up beside the report date, line for line", () => {
    const earlier = buildBalanceSheet({
      asAt: "2025-10-31",
      yearStart: "2024-11-01",
      accounts: ACCOUNTS,
      toDate: post(lastYear),
      beforeYear: [],
    });
    const rows = balanceSheetRows([sheet(), earlier]);
    expect(rows.find((r) => r.code === "1000")!.amounts).toEqual([300000, 0]);
    expect(rows.find((r) => r.code === "1100")!.amounts).toEqual([75000, 25000]);
    expect(rows.every((r) => r.amounts.length === 2)).toBe(true);
  });
});
