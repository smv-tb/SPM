import { describe, it, expect } from "vitest";
import { buildTrialBalance, type ReportAccount } from "@/lib/accounting/trial-balance";

const accounts: ReportAccount[] = [
  { id: "grant", code: "4900", name: "Grant income", type: "INCOME" },
  { id: "bank", code: "1200", name: "Bank", type: "ASSET" },
  { id: "rent", code: "6100", name: "Rent", type: "EXPENSE" },
  { id: "unused", code: "6200", name: "Utilities", type: "EXPENSE" },
];

describe("buildTrialBalance", () => {
  const movements = [
    { accountId: "bank", debit: 100000, credit: 0 },
    { accountId: "grant", debit: 0, credit: 100000 },
    { accountId: "rent", debit: 25000, credit: 0 },
    { accountId: "bank", debit: 0, credit: 25000 },
  ];

  it("nets each account onto one side, ordered by code, and balances", () => {
    const tb = buildTrialBalance(accounts, movements);
    expect(tb.rows.map((r) => [r.code, r.debit, r.credit])).toEqual([
      ["1200", 75000, 0],
      ["4900", 0, 100000],
      ["6100", 25000, 0],
    ]);
    expect(tb).toMatchObject({ totalDebit: 100000, totalCredit: 100000, balanced: true });
  });

  it("can include zero-balance accounts", () => {
    expect(buildTrialBalance(accounts, movements, { includeZero: true }).rows).toHaveLength(4);
  });

  it("reports an imbalance rather than hiding it", () => {
    const tb = buildTrialBalance(accounts, [{ accountId: "bank", debit: 1, credit: 0 }]);
    expect(tb.balanced).toBe(false);
  });

  it("stays balanced for any set of balanced journals", () => {
    // Property-style: random balanced two-line journals always produce a balanced TB.
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const ids = accounts.map((a) => a.id);
    const random = [];
    for (let i = 0; i < 500; i++) {
      const amount = Math.floor(rand() * 1_000_000) + 1;
      const dr = ids[Math.floor(rand() * ids.length)];
      const cr = ids[Math.floor(rand() * ids.length)];
      random.push({ accountId: dr, debit: amount, credit: 0 }, { accountId: cr, debit: 0, credit: amount });
    }
    expect(buildTrialBalance(accounts, random).balanced).toBe(true);
  });

  it("refuses movements for accounts it was not given", () => {
    expect(() => buildTrialBalance(accounts, [{ accountId: "ghost", debit: 1, credit: 0 }])).toThrow();
  });
});
