import { describe, it, expect } from "vitest";
import {
  deriveTrancheTransactions,
  deriveFundingRecordTransactions,
  deriveTaskTransactions,
  deriveLivingLabTransactions,
  buildMonthlyCashFlow,
  computeTrailingBurn,
  projectCashOut,
  monthKey,
} from "@/lib/cash-ledger";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOW = d("2026-08-25");

const fundingRecordStub = {
  projectId: "p1",
  fundName: "Innovate UK",
  phaseId: "ph1",
  date: d("2026-01-15"),
  createdAt: d("2026-07-20"),
};

describe("deriveTrancheTransactions", () => {
  const base = {
    label: "Q1",
    amount: 25000,
    dueDate: d("2026-03-01"),
    milestoneId: null,
    fundingRecord: fundingRecordStub,
  };

  it("books a received incoming tranche as cash in on its receipt date", () => {
    const [tx] = deriveTrancheTransactions([
      { ...base, id: "t1", status: "RECEIVED", direction: "INCOMING", receivedDate: d("2026-03-05") },
    ]);
    expect(tx.direction).toBe("IN");
    expect(tx.amount).toBe(25000);
    expect(tx.date).toEqual(d("2026-03-05"));
    expect(tx.sourceId).toBe("t1");
  });

  it("books a settled outgoing tranche as cash out", () => {
    const [tx] = deriveTrancheTransactions([
      { ...base, id: "t2", status: "RECEIVED", direction: "OUTGOING", receivedDate: d("2026-04-01") },
    ]);
    expect(tx.direction).toBe("OUT");
  });

  it("ignores unsettled tranches — those are forecast, not ledger", () => {
    expect(
      deriveTrancheTransactions([
        { ...base, id: "t3", status: "PENDING", direction: "INCOMING", receivedDate: null },
        { ...base, id: "t4", status: "DELAYED", direction: "INCOMING", receivedDate: null },
      ])
    ).toHaveLength(0);
  });

  it("falls back to the due date when a settled tranche has no receipt date", () => {
    const [tx] = deriveTrancheTransactions([
      { ...base, id: "t5", status: "RECEIVED", direction: "INCOMING", receivedDate: null },
    ]);
    expect(tx.date).toEqual(d("2026-03-01"));
  });
});

describe("deriveFundingRecordTransactions", () => {
  const base = {
    id: "f1",
    projectId: "p1",
    fundName: "Founder loan",
    verified: true,
    section: "FOUNDER",
    phaseId: null,
    date: d("2025-06-01"),
    createdAt: d("2026-07-20"),
  };

  it("books an award with no tranche schedule in full", () => {
    const [tx] = deriveFundingRecordTransactions([{ ...base, amount: 40000, tranches: [] }]);
    expect(tx.amount).toBe(40000);
    expect(tx.direction).toBe("IN");
    expect(tx.date).toEqual(d("2025-06-01"));
  });

  it("books only the unscheduled remainder when tranches cover part of it", () => {
    // Tranches produce their own ledger rows; double-booking here would
    // silently inflate every cash-in figure.
    const [tx] = deriveFundingRecordTransactions([
      {
        ...base,
        amount: 100000,
        tranches: [{ amount: 40000, direction: "INCOMING" }],
      },
    ]);
    expect(tx.amount).toBe(60000);
  });

  it("books nothing when tranches cover the whole award", () => {
    expect(
      deriveFundingRecordTransactions([
        { ...base, amount: 100000, tranches: [{ amount: 100000, direction: "INCOMING" }] },
      ])
    ).toHaveLength(0);
  });

  it("ignores outgoing tranches when working out what is scheduled", () => {
    const [tx] = deriveFundingRecordTransactions([
      {
        ...base,
        amount: 50000,
        tranches: [{ amount: 10000, direction: "OUTGOING" }],
      },
    ]);
    expect(tx.amount).toBe(50000);
  });

  it("skips unverified and pipeline records", () => {
    expect(
      deriveFundingRecordTransactions([
        { ...base, verified: false, amount: 10000, tranches: [] },
        { ...base, section: "PIPELINE", amount: 10000, tranches: [] },
      ])
    ).toHaveLength(0);
  });
});

describe("deriveTaskTransactions", () => {
  const base = {
    id: "task1",
    projectId: "p1",
    code: "T-1",
    title: "Build the thing",
    costCategoryId: "cc1",
    milestoneId: "m1",
    startDate: d("2026-06-01"),
    dueDate: d("2026-07-01"),
    updatedAt: d("2026-07-02"),
    milestone: { phaseId: "ph1" },
  };

  it("sums internal and external spend into one outflow", () => {
    const [tx] = deriveTaskTransactions([{ ...base, actualSpend: 400, extCosts: 130 }], NOW);
    expect(tx.amount).toBe(530);
    expect(tx.direction).toBe("OUT");
    expect(tx.costCategoryId).toBe("cc1");
    expect(tx.phaseId).toBe("ph1");
  });

  it("dates completed work at its due date", () => {
    const [tx] = deriveTaskTransactions([{ ...base, actualSpend: 100, extCosts: null }], NOW);
    expect(tx.date).toEqual(d("2026-07-01"));
  });

  it("dates not-yet-due work at its start date", () => {
    const [tx] = deriveTaskTransactions(
      [{ ...base, actualSpend: 100, extCosts: null, startDate: d("2026-08-01"), dueDate: d("2026-12-01") }],
      NOW
    );
    expect(tx.date).toEqual(d("2026-08-01"));
  });

  it("produces nothing for a task with no spend", () => {
    expect(deriveTaskTransactions([{ ...base, actualSpend: 0, extCosts: null }], NOW)).toHaveLength(0);
    expect(deriveTaskTransactions([{ ...base, actualSpend: null, extCosts: null }], NOW)).toHaveLength(0);
  });
});

describe("deriveLivingLabTransactions", () => {
  const base = {
    id: "lc1",
    actualSpend: 250,
    costCategoryId: null,
    milestoneId: null,
    startDate: d("2026-05-01"),
    endDate: d("2026-06-01"),
    lab: { projectId: "p1", name: "Funnibra Farm" },
  };

  it("skips rows mirrored from a task", () => {
    // Saving a task copies its spend into a LivingLabCost row per lab; counting
    // those here would duplicate the task outflow once per lab.
    expect(deriveLivingLabTransactions([{ ...base, taskId: "task1" }], NOW)).toHaveLength(0);
  });

  it("books a standalone lab cost as its own outflow", () => {
    const [tx] = deriveLivingLabTransactions([{ ...base, taskId: null }], NOW);
    expect(tx.amount).toBe(250);
    expect(tx.direction).toBe("OUT");
    expect(tx.date).toEqual(d("2026-06-01"));
  });

  it("falls back to now when a standalone cost has no dates at all", () => {
    const [tx] = deriveLivingLabTransactions(
      [{ ...base, taskId: null, startDate: null, endDate: null }],
      NOW
    );
    expect(tx.date).toEqual(NOW);
  });
});

describe("buildMonthlyCashFlow", () => {
  it("carries the opening balance through the closing balances", () => {
    const series = buildMonthlyCashFlow(
      [
        { date: d("2026-07-10"), amount: 1000, direction: "IN" },
        { date: d("2026-07-20"), amount: 400, direction: "OUT" },
        { date: d("2026-08-05"), amount: 200, direction: "OUT" },
      ],
      ["2026-07", "2026-08"],
      5000
    );
    expect(series[0]).toMatchObject({ cashIn: 1000, cashOut: 400, net: 600, closingBalance: 5600 });
    expect(series[1]).toMatchObject({ cashIn: 0, cashOut: 200, net: -200, closingBalance: 5400 });
  });

  it("reports empty months as zero rather than omitting them", () => {
    const series = buildMonthlyCashFlow([], ["2026-07", "2026-08"], 100);
    expect(series.map((s) => s.closingBalance)).toEqual([100, 100]);
  });
});

describe("computeTrailingBurn", () => {
  it("averages outflows over the trailing complete months", () => {
    const burn = computeTrailingBurn(
      [
        { date: d("2026-05-10"), amount: 600, direction: "OUT" },
        { date: d("2026-06-10"), amount: 600, direction: "OUT" },
        { date: d("2026-07-10"), amount: 600, direction: "OUT" },
        { date: d("2026-04-10"), amount: 1200, direction: "IN" },
      ],
      NOW,
      6
    );
    expect(burn).toBe(300); // 1800 over a 6-month window
  });

  it("excludes the current partial month", () => {
    // August is in progress; counting it would make burn look artificially low
    // on the 1st of the month and jump around all month.
    const burn = computeTrailingBurn(
      [{ date: d("2026-08-02"), amount: 9000, direction: "OUT" }],
      NOW,
      6
    );
    expect(burn).toBeNull();
  });

  it("returns null when there is no outflow history to average", () => {
    expect(computeTrailingBurn([{ date: d("2026-06-01"), amount: 500, direction: "IN" }], NOW)).toBeNull();
  });
});

describe("projectCashOut", () => {
  it("finds the month the balance first goes negative", () => {
    const { cashOutMonth, monthsRemaining } = projectCashOut(10000, 2500, [], NOW, 12);
    // 10000 / 2500 = 4 full months; the 5th (index 4) closes negative.
    expect(monthsRemaining).toBe(4);
    expect(cashOutMonth).toBe("2026-12");
  });

  it("pushes the cash-out date back when money is scheduled to land", () => {
    const withGrant = projectCashOut(
      10000,
      2500,
      [{ date: d("2026-10-15"), amount: 20000, direction: "IN", probability: 1, label: "Grant" }],
      NOW,
      24
    );
    expect(withGrant.monthsRemaining).toBeGreaterThan(4);
  });

  it("weights pipeline money by its probability", () => {
    const flow = { date: d("2026-10-15"), amount: 20000, direction: "IN" as const, label: "Maybe" };
    const certain = projectCashOut(10000, 2500, [{ ...flow, probability: 1 }], NOW, 24);
    const unlikely = projectCashOut(10000, 2500, [{ ...flow, probability: 0.25 }], NOW, 24);
    expect(certain.monthsRemaining!).toBeGreaterThan(unlikely.monthsRemaining!);
    expect(certain.projection[2].scheduledIn).toBe(20000);
    expect(unlikely.projection[2].scheduledIn).toBe(5000);
  });

  it("brings the cash-out date forward when a repayment is due", () => {
    const clean = projectCashOut(10000, 2500, [], NOW, 24);
    const withRepayment = projectCashOut(
      10000,
      2500,
      [{ date: d("2026-09-15"), amount: 6000, direction: "OUT", probability: 1, label: "Loan refund" }],
      NOW,
      24
    );
    expect(withRepayment.monthsRemaining!).toBeLessThan(clean.monthsRemaining!);
  });

  it("reports an already-overdrawn project at month zero", () => {
    const { monthsRemaining, cashOutMonth } = projectCashOut(-500, 100, [], NOW, 12);
    expect(monthsRemaining).toBe(0);
    expect(cashOutMonth).toBe(monthKey(NOW));
  });

  it("returns null when the balance never goes negative in the horizon", () => {
    const { cashOutMonth, monthsRemaining } = projectCashOut(100000, 0, [], NOW, 12);
    expect(cashOutMonth).toBeNull();
    expect(monthsRemaining).toBeNull();
  });
});
