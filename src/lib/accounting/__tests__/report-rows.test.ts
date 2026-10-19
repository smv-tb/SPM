import { describe, it, expect } from "vitest";
import { agedDebtorsRows, AGED_DEBTORS_COLUMNS, trialBalanceRows, TRIAL_BALANCE_COLUMNS } from "@/lib/accounting/report-rows";
import { renderReportPdf } from "@/lib/accounting/report-pdf";
import { buildTrialBalance } from "@/lib/accounting/trial-balance";
import type { AgedDebtors } from "@/lib/accounting/aged-debtors";

const company = { legalName: "Test Ltd", companyNumber: "123", placeOfRegistration: "England" };

describe("trialBalanceRows", () => {
  const tb = buildTrialBalance(
    [
      { id: "a", code: "1200", name: "Bank", type: "ASSET" },
      { id: "b", code: "3000", name: "Share capital", type: "EQUITY" },
    ],
    [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ]
  );

  it("has a Debit and Credit column per account and totals last", () => {
    const rows = trialBalanceRows(tb);
    expect(rows.map((r) => r.amounts)).toEqual([[100, null], [null, 100], [100, 100]]);
    expect(rows.at(-1)!.kind).toBe("grandTotal");
  });

  it("renders as a PDF", async () => {
    const pdf = await renderReportPdf({ title: "Trial balance", company, subtitle: "x", columns: TRIAL_BALANCE_COLUMNS, rows: trialBalanceRows(tb) });
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("agedDebtorsRows", () => {
  const zero = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
  const report = {
    asAt: "2026-10-12",
    rows: [{ contactId: "c", contactName: "Acme", ...zero, days1to30: 5000, unusedCredit: 1000, balance: 4000 }],
    totals: { ...zero, days1to30: 5000, unusedCredit: 1000, balance: 4000 },
  } as unknown as AgedDebtors;

  it("lines up with its seven column headings, showing unused credit as a reduction", () => {
    const rows = agedDebtorsRows(report);
    expect(AGED_DEBTORS_COLUMNS).toHaveLength(7);
    expect(rows[0].amounts).toEqual([0, 5000, 0, 0, 0, -1000, 4000]);
    expect(rows.at(-1)!.amounts).toEqual(rows[0].amounts);
  });

  it("renders as a PDF", async () => {
    const pdf = await renderReportPdf({ title: "Aged debtors", company, subtitle: "x", columns: AGED_DEBTORS_COLUMNS, rows: agedDebtorsRows(report) });
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
  });
});
