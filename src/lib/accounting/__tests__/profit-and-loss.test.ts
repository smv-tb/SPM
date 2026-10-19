import { describe, it, expect } from "vitest";
import { buildProfitAndLoss, pnlGroupFor, profitAndLossRows } from "@/lib/accounting/profit-and-loss";
import type { AccountMovement, ReportAccount } from "@/lib/accounting/trial-balance";

const acct = (code: string, name: string, type: ReportAccount["type"]): ReportAccount => ({ id: code, code, name, type });
const ACCOUNTS = [
  acct("1200", "Bank", "ASSET"),
  acct("4000", "Sales", "INCOME"),
  acct("4900", "Grant income", "INCOME"),
  acct("5000", "Cost of sales", "EXPENSE"),
  acct("6700", "Bank charges", "EXPENSE"),
  acct("7000", "Research and development", "EXPENSE"),
  acct("8000", "Interest paid", "EXPENSE"),
];
const mv = (accountId: string, debit: number, credit: number): AccountMovement => ({ accountId, debit, credit });

const period = (movements: AccountMovement[], from = "2026-01-01", to = "2026-12-31") =>
  buildProfitAndLoss({ from, to, accounts: ACCOUNTS, movements });

describe("pnlGroupFor", () => {
  it("places accounts by type and code range, and ignores the balance sheet", () => {
    expect(pnlGroupFor("INCOME", "4900")).toBe("income");
    expect(pnlGroupFor("EXPENSE", "5100")).toBe("costOfSales");
    expect(pnlGroupFor("EXPENSE", "6000")).toBe("operating");
    expect(pnlGroupFor("EXPENSE", "7900")).toBe("operating");
    expect(pnlGroupFor("EXPENSE", "8000")).toBe("finance");
    expect(pnlGroupFor("ASSET", "1200")).toBeNull();
  });
});

describe("buildProfitAndLoss", () => {
  const report = period([
    mv("4000", 0, 100000),
    mv("4900", 0, 50000),
    mv("5000", 30000, 0),
    mv("6700", 750, 0),
    mv("7000", 20000, 0),
    mv("8000", 1000, 0),
    mv("1200", 999999, 0), // balance sheet movement: must not count
  ]);

  it("adds up income, cost of sales, gross profit, expenses and net profit", () => {
    expect(report.income).toBe(150000);
    expect(report.costOfSales).toBe(30000);
    expect(report.grossProfit).toBe(120000);
    expect(report.expenses).toBe(21750);
    expect(report.netProfit).toBe(98250);
  });

  it("nets credits against debits on each side, so a refund reduces income", () => {
    const r = period([mv("4000", 2500, 100000), mv("6700", 0, 100)]);
    expect(r.income).toBe(97500);
    expect(r.expenses).toBe(-100);
    expect(r.netProfit).toBe(97600);
  });

  it("reports a loss as negative", () => {
    expect(period([mv("6700", 500, 0)]).netProfit).toBe(-500);
  });

  it("is zero for an empty period", () => {
    const r = period([]);
    expect([r.income, r.grossProfit, r.netProfit]).toEqual([0, 0, 0]);
  });
});

describe("profitAndLossRows", () => {
  const a = period([mv("4000", 0, 100000), mv("5000", 30000, 0), mv("6700", 750, 0)]);
  const b = period([mv("4000", 0, 80000), mv("7000", 5000, 0)], "2025-01-01", "2025-12-31");

  it("hides lines and sections that are zero in every column", () => {
    const labels = profitAndLossRows([a]).map((r) => r.label);
    expect(labels).toContain("Sales");
    expect(labels).not.toContain("Grant income");
    expect(labels).not.toContain("Interest paid");
    expect(labels).not.toContain("Finance costs");
    expect(labels).toContain("Gross profit");
  });

  it("shows zero lines when asked", () => {
    expect(profitAndLossRows([a], { includeZero: true }).map((r) => r.label)).toContain("Grant income");
  });

  it("aligns a comparative period by account and keeps a line that only one period has", () => {
    const rows = profitAndLossRows([a, b]);
    expect(rows.find((r) => r.label === "Sales")!.amounts).toEqual([100000, 80000]);
    expect(rows.find((r) => r.label === "Research and development")!.amounts).toEqual([0, 5000]);
  });

  it("ends with net profit equal to the report's, per column", () => {
    const last = profitAndLossRows([a, b]).at(-1)!;
    expect(last.kind).toBe("grandTotal");
    expect(last.amounts).toEqual([a.netProfit, b.netProfit]);
  });

  it("always shows the income section, even with no income", () => {
    expect(profitAndLossRows([period([mv("6700", 500, 0)])]).map((r) => r.label)).toContain("Total income");
  });

  it("prints expense sub-headings only when more than one group has lines", () => {
    const one = profitAndLossRows([a]).map((r) => r.label);
    expect(one).not.toContain("Operating expenses");
    const two = profitAndLossRows([period([mv("6700", 500, 0), mv("8000", 100, 0)])]).map((r) => r.label);
    expect(two).toContain("Operating expenses");
    expect(two).toContain("Finance costs");
  });
});
