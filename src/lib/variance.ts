import type { Prisma } from "@prisma/client";

/**
 * Budget vs actual variance.
 *
 * Deliberately pure functions over plain rows: the same logic serves the phase,
 * milestone and cost-category breakdowns, the API route, and Hermes, without
 * any of them re-deriving "is this over budget" slightly differently — which is
 * exactly how the funding figures drifted apart in the first place.
 */

type Money = number | string | Prisma.Decimal;

/** How far under budget still counts as on track, as a fraction of budget. */
export const ON_TRACK_BAND = 0.1;

export type VarianceStatus = "UNDER" | "ON_TRACK" | "OVER" | "NO_BUDGET";

export interface VarianceInput {
  id: string;
  name: string;
  estBudget: Money | null | undefined;
  actualSpend: Money | null | undefined;
}

export interface VarianceRow {
  id: string;
  name: string;
  estBudget: number;
  actualSpend: number;
  /** Budget minus actual. Positive means money left, negative means overspend. */
  variance: number;
  /** Variance as a fraction of budget, or null when there is no budget to compare against. */
  variancePct: number | null;
  /** Actual as a fraction of budget, capped at 1 for progress bars. */
  utilization: number | null;
  status: VarianceStatus;
}

/**
 * A row with no budget is reported as NO_BUDGET rather than as a 100% overspend.
 * Spend without a budget is a planning gap, not a cost overrun, and calling it
 * "over" buries the genuine overruns in noise.
 */
export function computeVarianceRow(input: VarianceInput, band = ON_TRACK_BAND): VarianceRow {
  const estBudget = Number(input.estBudget ?? 0);
  const actualSpend = Number(input.actualSpend ?? 0);
  const variance = estBudget - actualSpend;

  if (estBudget <= 0) {
    return {
      id: input.id,
      name: input.name,
      estBudget,
      actualSpend,
      variance,
      variancePct: null,
      utilization: null,
      status: "NO_BUDGET",
    };
  }

  const utilization = actualSpend / estBudget;
  let status: VarianceStatus;
  if (actualSpend > estBudget) status = "OVER";
  else if (utilization >= 1 - band) status = "ON_TRACK";
  else status = "UNDER";

  return {
    id: input.id,
    name: input.name,
    estBudget,
    actualSpend,
    variance,
    variancePct: variance / estBudget,
    utilization: Math.min(utilization, 1),
    status,
  };
}

export function computeVariance(inputs: VarianceInput[], band = ON_TRACK_BAND): VarianceRow[] {
  return inputs.map((i) => computeVarianceRow(i, band));
}

export interface VarianceTotals {
  estBudget: number;
  actualSpend: number;
  variance: number;
  variancePct: number | null;
  overCount: number;
  noBudgetCount: number;
  /** Total overspend across only the rows that are over — netting against
   *  underspent rows would hide it, which is the whole point of the number. */
  overspend: number;
}

export function summarizeVariance(rows: VarianceRow[]): VarianceTotals {
  const estBudget = rows.reduce((s, r) => s + r.estBudget, 0);
  const actualSpend = rows.reduce((s, r) => s + r.actualSpend, 0);
  const variance = estBudget - actualSpend;

  return {
    estBudget,
    actualSpend,
    variance,
    variancePct: estBudget > 0 ? variance / estBudget : null,
    overCount: rows.filter((r) => r.status === "OVER").length,
    noBudgetCount: rows.filter((r) => r.status === "NO_BUDGET").length,
    overspend: rows.filter((r) => r.status === "OVER").reduce((s, r) => s + (r.actualSpend - r.estBudget), 0),
  };
}

interface GroupableRow {
  groupId: string | null;
  estBudget: Money | null | undefined;
  actualSpend: Money | null | undefined;
}

/**
 * Rolls task-level budget and spend up to whatever they are grouped by (phase,
 * cost category, owner). Rows with no group land under `unassignedName` rather
 * than being dropped — unattributed spend is the thing you most want to see.
 */
export function groupVariance(
  rows: GroupableRow[],
  names: Map<string, string>,
  unassignedName = "Unassigned",
  band = ON_TRACK_BAND
): VarianceRow[] {
  const totals = new Map<string, { est: number; actual: number }>();

  for (const r of rows) {
    const key = r.groupId ?? "__unassigned__";
    const entry = totals.get(key) ?? { est: 0, actual: 0 };
    entry.est += Number(r.estBudget ?? 0);
    entry.actual += Number(r.actualSpend ?? 0);
    totals.set(key, entry);
  }

  return [...totals.entries()]
    .map(([id, t]) =>
      computeVarianceRow(
        {
          id,
          name: id === "__unassigned__" ? unassignedName : names.get(id) ?? id,
          estBudget: t.est,
          actualSpend: t.actual,
        },
        band
      )
    )
    .sort((a, b) => a.variance - b.variance); // worst overrun first
}
