import { describe, it, expect } from "vitest";
import {
  FUNDING_STAGES,
  FUNDING_STAGE_META,
  TERMINAL_STAGES,
  isTerminalStage,
  computeWeightedForecast,
  computeRunwayMonths,
  computeTotalSpend,
  computeTaskSpend,
  computeCashPosition,
  computeBurnWindowStart,
  computeActiveMonths,
  computeFundingForecast,
  computePhaseUtilization,
  isOverdue,
  summarizeTranches,
} from "@/lib/funding";

describe("FUNDING_STAGE_META", () => {
  it("has a metadata entry for every stage", () => {
    for (const stage of FUNDING_STAGES) {
      expect(FUNDING_STAGE_META[stage]).toBeDefined();
      expect(FUNDING_STAGE_META[stage].label).toBeTruthy();
      expect(FUNDING_STAGE_META[stage].defaultProbability).toBeGreaterThanOrEqual(0);
      expect(FUNDING_STAGE_META[stage].defaultProbability).toBeLessThanOrEqual(100);
    }
  });
});

describe("isTerminalStage", () => {
  it("flags AWARDED/REJECTED/WITHDRAWN as terminal", () => {
    for (const stage of TERMINAL_STAGES) {
      expect(isTerminalStage(stage)).toBe(true);
    }
  });

  it("does not flag open stages as terminal", () => {
    expect(isTerminalStage("PROSPECT")).toBe(false);
    expect(isTerminalStage(null)).toBe(false);
    expect(isTerminalStage(undefined)).toBe(false);
  });
});

describe("computeWeightedForecast", () => {
  it("returns 0 for an empty list", () => {
    expect(computeWeightedForecast([])).toBe(0);
  });

  it("weights each record by probability/100", () => {
    const result = computeWeightedForecast([
      { probability: 50, amount: 1000 },
      { probability: 100, amount: 2000 },
      { probability: 0, amount: 5000 },
    ]);
    expect(result).toBe(500 + 2000 + 0);
  });

  it("treats a missing probability as 0", () => {
    expect(computeWeightedForecast([{ amount: 1000 }])).toBe(0);
  });
});

describe("computeRunwayMonths", () => {
  it("divides remaining cash by average monthly burn", () => {
    expect(computeRunwayMonths(12000, 3000)).toBe(4);
  });

  it("returns null for zero burn", () => {
    expect(computeRunwayMonths(12000, 0)).toBeNull();
  });

  it("returns null for negative burn", () => {
    expect(computeRunwayMonths(12000, -100)).toBeNull();
  });
});

describe("computeTotalSpend", () => {
  it("sums task, Living Lab, and historical spend together", () => {
    expect(computeTotalSpend(400, 0, 0)).toBe(400);
    expect(computeTotalSpend(400, 12000, 5000)).toBe(17400);
  });

  it("treats each source as additive even when others are zero", () => {
    expect(computeTotalSpend(0, 0, 3000)).toBe(3000);
  });

  it("counts repaid outflows as cash gone", () => {
    expect(computeTotalSpend(1000, 0, 0, 500)).toBe(1500);
  });

  it("defaults repaid outflows to zero for existing three-arg callers", () => {
    expect(computeTotalSpend(1000, 200, 300)).toBe(1500);
  });
});

describe("isOverdue", () => {
  const reference = new Date("2026-07-22T00:00:00Z");

  it("returns false for a null/undefined date", () => {
    expect(isOverdue(null, reference)).toBe(false);
    expect(isOverdue(undefined, reference)).toBe(false);
  });

  it("returns true for a date before the reference", () => {
    expect(isOverdue("2026-01-01", reference)).toBe(true);
  });

  it("returns false for a date after the reference", () => {
    expect(isOverdue("2026-12-01", reference)).toBe(false);
  });
});

describe("summarizeTranches", () => {
  const zeroSummary = { receivedCount: 0, totalCount: 0, receivedAmount: 0, totalAmount: 0 };

  it("returns zeroes for an empty list", () => {
    expect(summarizeTranches([])).toEqual({
      ...zeroSummary,
      incoming: zeroSummary,
      outgoing: zeroSummary,
    });
  });

  it("counts only RECEIVED tranches as received, combined across directions", () => {
    const result = summarizeTranches([
      { amount: 1000, status: "RECEIVED" },
      { amount: 2000, status: "PENDING" },
      { amount: 3000, status: "DELAYED" },
    ]);
    expect(result.receivedCount).toBe(1);
    expect(result.totalCount).toBe(3);
    expect(result.receivedAmount).toBe(1000);
    expect(result.totalAmount).toBe(6000);
  });

  it("defaults tranches without a direction to incoming", () => {
    const result = summarizeTranches([{ amount: 1000, status: "PENDING" }]);
    expect(result.incoming).toEqual({ receivedCount: 0, totalCount: 1, receivedAmount: 0, totalAmount: 1000 });
    expect(result.outgoing).toEqual(zeroSummary);
  });

  it("splits incoming (receipts) from outgoing (repayments)", () => {
    const result = summarizeTranches([
      { amount: 1000, status: "RECEIVED", direction: "INCOMING" },
      { amount: 500, status: "PENDING", direction: "INCOMING" },
      { amount: 300, status: "RECEIVED", direction: "OUTGOING" },
      { amount: 200, status: "PENDING", direction: "OUTGOING" },
    ]);
    expect(result.incoming).toEqual({ receivedCount: 1, totalCount: 2, receivedAmount: 1000, totalAmount: 1500 });
    expect(result.outgoing).toEqual({ receivedCount: 1, totalCount: 2, receivedAmount: 300, totalAmount: 500 });
    // Combined totals still reflect everything, regardless of direction.
    expect(result.totalCount).toBe(4);
    expect(result.totalAmount).toBe(2000);
  });
});

describe("computeTaskSpend", () => {
  it("counts external costs alongside internal actuals", () => {
    expect(computeTaskSpend(40000, 60000)).toBe(100000);
  });

  it("treats missing pots as zero", () => {
    expect(computeTaskSpend(null, undefined)).toBe(0);
    expect(computeTaskSpend("2500.50", null)).toBe(2500.5);
  });
});

describe("computeCashPosition", () => {
  const verifiedLive = { verified: true, section: "LIVE" as const };

  it("banks an award in full when it has no tranche schedule", () => {
    const cash = computeCashPosition([{ ...verifiedLive, amount: 100000 }]);
    expect(cash.securedCash).toBe(100000);
    expect(cash.bankedCash).toBe(100000);
    expect(cash.awaitingReceipt).toBe(0);
  });

  it("banks only received tranches, leaving the rest awaiting receipt", () => {
    const cash = computeCashPosition([
      {
        ...verifiedLive,
        amount: 500000,
        tranches: [
          { amount: 125000, status: "RECEIVED", direction: "INCOMING" },
          { amount: 125000, status: "PENDING", direction: "INCOMING" },
          { amount: 125000, status: "PENDING", direction: "INCOMING" },
          { amount: 125000, status: "DELAYED", direction: "INCOMING" },
        ],
      },
    ]);
    expect(cash.securedCash).toBe(500000);
    expect(cash.bankedCash).toBe(125000);
    expect(cash.awaitingReceipt).toBe(375000);
  });

  it("banks the slice of an award never scheduled through a tranche", () => {
    const cash = computeCashPosition([
      {
        ...verifiedLive,
        amount: 100000,
        // Only 40k is scheduled; the other 60k arrived without a tranche row.
        tranches: [{ amount: 40000, status: "PENDING", direction: "INCOMING" }],
      },
    ]);
    expect(cash.bankedCash).toBe(60000);
    expect(cash.awaitingReceipt).toBe(40000);
  });

  it("never banks more than the award when tranches over-schedule it", () => {
    const cash = computeCashPosition([
      {
        ...verifiedLive,
        amount: 50000,
        tranches: [{ amount: 80000, status: "PENDING", direction: "INCOMING" }],
      },
    ]);
    expect(cash.bankedCash).toBe(0);
  });

  it("splits outgoing tranches into repaid and still-committed", () => {
    const cash = computeCashPosition([
      {
        verified: true,
        section: "FOUNDER",
        amount: 200000,
        tranches: [
          { amount: 30000, status: "RECEIVED", direction: "OUTGOING" },
          { amount: 60000, status: "PENDING", direction: "OUTGOING" },
        ],
      },
    ]);
    expect(cash.repaidOutflows).toBe(30000);
    expect(cash.committedOutflows).toBe(60000);
    // An outgoing tranche never reduces the incoming side of the record.
    expect(cash.bankedCash).toBe(200000);
  });

  it("ignores unverified and pipeline records for the cash position", () => {
    const cash = computeCashPosition([
      { verified: false, section: "LIVE", amount: 150000 },
      { verified: true, section: "PIPELINE", amount: 900000 },
    ]);
    expect(cash.securedCash).toBe(0);
    expect(cash.bankedCash).toBe(0);
  });

  it("still counts repayments booked against an unverified record", () => {
    const cash = computeCashPosition([
      {
        verified: false,
        section: "LIVE",
        amount: 150000,
        tranches: [{ amount: 5000, status: "RECEIVED", direction: "OUTGOING" }],
      },
    ]);
    expect(cash.securedCash).toBe(0);
    expect(cash.repaidOutflows).toBe(5000);
  });
});

describe("computeBurnWindowStart", () => {
  const now = new Date("2026-08-25T00:00:00Z");

  it("prefers the project start date over row insert timestamps", () => {
    // The ODS migration inserts every historical record in one run, so every
    // createdAt is the import date — using it collapses years into weeks.
    const importedAt = new Date("2026-07-20T00:00:00Z");
    const start = computeBurnWindowStart(
      new Date("2024-01-01T00:00:00Z"),
      [{ createdAt: importedAt }, { createdAt: importedAt }],
      now
    );
    expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("falls back to the earliest economic funding date", () => {
    const start = computeBurnWindowStart(
      null,
      [
        { date: new Date("2025-03-01T00:00:00Z"), createdAt: new Date("2026-07-20T00:00:00Z") },
        { date: null, createdAt: new Date("2026-07-20T00:00:00Z") },
      ],
      now
    );
    expect(start.toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });

  it("ignores future dates, which would give a negative window", () => {
    const start = computeBurnWindowStart(
      new Date("2027-01-01T00:00:00Z"),
      [{ createdAt: new Date("2026-06-01T00:00:00Z") }],
      now
    );
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns now when there is nothing to anchor to", () => {
    expect(computeBurnWindowStart(null, [], now).getTime()).toBe(now.getTime());
  });
});

describe("computeActiveMonths", () => {
  const now = new Date("2026-08-25T00:00:00Z");

  it("counts whole months since the window opened", () => {
    expect(computeActiveMonths(new Date("2025-08-25T00:00:00Z"), now)).toBe(12);
  });

  it("floors at 1 so the burn division stays finite", () => {
    expect(computeActiveMonths(now, now)).toBe(1);
  });
});

describe("computeFundingForecast", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const base = { section: "PIPELINE", deadline: null, nextActionDate: null };

  it("excludes rejected and withdrawn bids from the weighted forecast", () => {
    // A lost bid keeps whatever probability it had when it died, so the
    // forecast has to filter on stage, not trust probability alone.
    const result = computeFundingForecast(
      [
        { ...base, stage: "SUBMITTED", amount: 100000, probability: 40 },
        { ...base, stage: "REJECTED", amount: 500000, probability: 60 },
        { ...base, stage: "WITHDRAWN", amount: 200000, probability: 25 },
      ],
      now
    );
    expect(result.weightedForecast).toBe(40000);
    expect(result.totalPipeline).toBe(100000);
  });

  it("does not track withdrawn funds in stage totals or deadlines", () => {
    const result = computeFundingForecast(
      [
        { ...base, stage: "WITHDRAWN", amount: 200000, probability: 25, deadline: new Date("2026-08-30T00:00:00Z") },
      ],
      now
    );
    expect(result.byStage).not.toHaveProperty("WITHDRAWN");
    expect(result.upcomingDeadlines).toHaveLength(0);
  });

  it("keeps awarded bids in both the weighted and total figures", () => {
    const result = computeFundingForecast(
      [{ ...base, stage: "AWARDED", amount: 100000, probability: 100 }],
      now
    );
    expect(result.weightedForecast).toBe(100000);
    expect(result.totalPipeline).toBe(100000);
  });

  it("buckets an unstaged pipeline record under PROSPECT rather than nowhere", () => {
    const result = computeFundingForecast(
      [{ ...base, stage: null, amount: 75000, probability: 10 }],
      now
    );
    expect(result.byStage.PROSPECT.count).toBe(1);
    expect(result.byStage.PROSPECT.totalAmount).toBe(75000);
    const bucketed = Object.values(result.byStage).reduce((s, b) => s + b.count, 0);
    expect(bucketed).toBe(1);
  });

  it("ignores non-pipeline sections entirely", () => {
    const result = computeFundingForecast(
      [{ section: "LIVE", stage: null, amount: 999999, probability: 100, deadline: null, nextActionDate: null }],
      now
    );
    expect(result.weightedForecast).toBe(0);
    expect(result.totalPipeline).toBe(0);
  });
});

describe("computePhaseUtilization", () => {
  it("splits a shared phase's spend across the records funding it", () => {
    // Previously every record was charged the whole project's spend, so the
    // small ones always read as over budget.
    const util = computePhaseUtilization(
      [
        { id: "big", amount: 300000, phaseId: "p1" },
        { id: "small", amount: 100000, phaseId: "p1" },
      ],
      new Map([["p1", 80000]])
    );
    expect(util.get("big")!.totalSpent).toBe(60000);
    expect(util.get("small")!.totalSpent).toBe(20000);
    expect(util.get("big")!.utilization).toBeCloseTo(0.2);
    expect(util.get("small")!.utilization).toBeCloseTo(0.2);
    expect(util.get("small")!.isOverBudget).toBe(false);
  });

  it("returns null rather than a misleading bar when there is no phase", () => {
    const util = computePhaseUtilization(
      [{ id: "orphan", amount: 100000, phaseId: null }],
      new Map([["p1", 80000]])
    );
    expect(util.get("orphan")).toEqual({ totalSpent: null, utilization: null, isOverBudget: false });
  });

  it("flags a genuine overspend and caps the bar at 100%", () => {
    const util = computePhaseUtilization(
      [{ id: "only", amount: 50000, phaseId: "p1" }],
      new Map([["p1", 75000]])
    );
    expect(util.get("only")!.isOverBudget).toBe(true);
    expect(util.get("only")!.utilization).toBe(1);
  });

  it("reports zero spend for a phase with no tasks", () => {
    const util = computePhaseUtilization([{ id: "a", amount: 10000, phaseId: "p9" }], new Map());
    expect(util.get("a")!.totalSpent).toBe(0);
    expect(util.get("a")!.utilization).toBe(0);
  });
});
