import { describe, it, expect } from "vitest";
import {
  computeVarianceRow,
  computeVariance,
  summarizeVariance,
  groupVariance,
} from "@/lib/variance";

describe("computeVarianceRow", () => {
  it("reports money left when spend is under budget", () => {
    const row = computeVarianceRow({ id: "a", name: "A", estBudget: 10000, actualSpend: 6000 });
    expect(row.variance).toBe(4000);
    expect(row.variancePct).toBeCloseTo(0.4);
    expect(row.status).toBe("UNDER");
  });

  it("reports an overspend as a negative variance", () => {
    const row = computeVarianceRow({ id: "a", name: "A", estBudget: 10000, actualSpend: 12500 });
    expect(row.variance).toBe(-2500);
    expect(row.status).toBe("OVER");
    // Utilization is capped so progress bars don't overflow their track.
    expect(row.utilization).toBe(1);
  });

  it("treats spend inside the band as on track", () => {
    expect(computeVarianceRow({ id: "a", name: "A", estBudget: 10000, actualSpend: 9500 }).status).toBe("ON_TRACK");
    expect(computeVarianceRow({ id: "a", name: "A", estBudget: 10000, actualSpend: 10000 }).status).toBe("ON_TRACK");
  });

  it("honours a custom band", () => {
    expect(
      computeVarianceRow({ id: "a", name: "A", estBudget: 10000, actualSpend: 8000 }, 0.3).status
    ).toBe("ON_TRACK");
  });

  it("flags spend with no budget rather than calling it a 100% overrun", () => {
    // Unbudgeted spend is a planning gap, not a cost overrun — reporting it as
    // OVER would bury the genuine overruns.
    const row = computeVarianceRow({ id: "a", name: "A", estBudget: 0, actualSpend: 5000 });
    expect(row.status).toBe("NO_BUDGET");
    expect(row.variancePct).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.variance).toBe(-5000);
  });

  it("treats null budget and null spend as zero", () => {
    const row = computeVarianceRow({ id: "a", name: "A", estBudget: null, actualSpend: null });
    expect(row.estBudget).toBe(0);
    expect(row.actualSpend).toBe(0);
    expect(row.status).toBe("NO_BUDGET");
  });

  it("accepts Decimal-like string amounts", () => {
    const row = computeVarianceRow({ id: "a", name: "A", estBudget: "1000.50", actualSpend: "500.25" });
    expect(row.variance).toBeCloseTo(500.25);
  });
});

describe("summarizeVariance", () => {
  const rows = computeVariance([
    { id: "a", name: "A", estBudget: 10000, actualSpend: 12000 }, // over by 2000
    { id: "b", name: "B", estBudget: 10000, actualSpend: 3000 }, // under by 7000
    { id: "c", name: "C", estBudget: 0, actualSpend: 500 }, // no budget
  ]);

  it("totals budget and actuals across rows", () => {
    const totals = summarizeVariance(rows);
    expect(totals.estBudget).toBe(20000);
    expect(totals.actualSpend).toBe(15500);
    expect(totals.variance).toBe(4500);
  });

  it("counts overruns and unbudgeted rows separately", () => {
    const totals = summarizeVariance(rows);
    expect(totals.overCount).toBe(1);
    expect(totals.noBudgetCount).toBe(1);
  });

  it("reports gross overspend without netting it against underspend", () => {
    // Net variance is a healthy +4500 while one line is 2000 over. Netting
    // would hide the overrun, which is the one number worth surfacing.
    expect(summarizeVariance(rows).overspend).toBe(2000);
  });
});

describe("groupVariance", () => {
  const names = new Map([
    ["p1", "Discovery"],
    ["p2", "Build"],
  ]);

  it("rolls rows up to their group", () => {
    const grouped = groupVariance(
      [
        { groupId: "p1", estBudget: 1000, actualSpend: 400 },
        { groupId: "p1", estBudget: 2000, actualSpend: 900 },
        { groupId: "p2", estBudget: 5000, actualSpend: 5000 },
      ],
      names
    );
    const discovery = grouped.find((g) => g.id === "p1")!;
    expect(discovery.name).toBe("Discovery");
    expect(discovery.estBudget).toBe(3000);
    expect(discovery.actualSpend).toBe(1300);
  });

  it("keeps ungrouped rows visible instead of dropping them", () => {
    // Unattributed spend is the thing you most want to find.
    const grouped = groupVariance(
      [{ groupId: null, estBudget: 0, actualSpend: 750 }],
      names,
      "No phase"
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe("No phase");
    expect(grouped[0].actualSpend).toBe(750);
  });

  it("sorts the worst overrun first", () => {
    const grouped = groupVariance(
      [
        { groupId: "p1", estBudget: 1000, actualSpend: 500 },
        { groupId: "p2", estBudget: 1000, actualSpend: 4000 },
      ],
      names
    );
    expect(grouped[0].id).toBe("p2");
    expect(grouped[0].variance).toBe(-3000);
  });

  it("falls back to the group id when no name is known", () => {
    const grouped = groupVariance([{ groupId: "ghost", estBudget: 10, actualSpend: 1 }], names);
    expect(grouped[0].name).toBe("ghost");
  });
});
