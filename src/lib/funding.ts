import type { Prisma } from "@prisma/client";
import { fromPence, sumPence, toPenceOrZero, type MoneyInput } from "@/lib/money";

export const FUNDING_STAGES = [
  "PROSPECT",
  "PREPARING",
  "SUBMITTED",
  "IN_REVIEW",
  "AWARDED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type FundingStage = (typeof FUNDING_STAGES)[number];

/** Stages shown on the pipeline board and counted in pipeline totals. A
 *  withdrawn fund is no longer being pursued, so it is not tracked there. */
export const PIPELINE_STAGES = FUNDING_STAGES.filter((s) => s !== "WITHDRAWN");

export function isTrackedInPipeline(stage: string | null | undefined): boolean {
  return stage !== "WITHDRAWN";
}

export const TERMINAL_STAGES: FundingStage[] = ["AWARDED", "REJECTED", "WITHDRAWN"];

export const FUNDING_STAGE_META: Record<
  FundingStage,
  { label: string; color: string; defaultProbability: number }
> = {
  PROSPECT: { label: "Prospect", color: "bg-gray-100 text-gray-700", defaultProbability: 10 },
  PREPARING: { label: "Preparing", color: "bg-blue-100 text-blue-700", defaultProbability: 25 },
  SUBMITTED: { label: "Submitted", color: "bg-indigo-100 text-indigo-700", defaultProbability: 40 },
  IN_REVIEW: { label: "In Review", color: "bg-amber-100 text-amber-700", defaultProbability: 60 },
  AWARDED: { label: "Awarded", color: "bg-emerald-100 text-emerald-700", defaultProbability: 100 },
  REJECTED: { label: "Rejected", color: "bg-red-100 text-red-700", defaultProbability: 0 },
  WITHDRAWN: { label: "Withdrawn", color: "bg-slate-100 text-slate-500", defaultProbability: 0 },
};

export function isTerminalStage(stage: string | null | undefined): boolean {
  return !!stage && (TERMINAL_STAGES as string[]).includes(stage);
}

interface ForecastRecord {
  probability?: number | null;
  amount: number | string | Prisma.Decimal;
}

/** Σ(probability/100 × amount) across the given records. */
export function computeWeightedForecast(records: ForecastRecord[]): number {
  return records.reduce(
    (sum, r) => sum + (Number(r.probability ?? 0) / 100) * Number(r.amount),
    0
  );
}

/**
 * Months of runway remaining at the given burn rate.
 * Returns null (rendered as "—"/"∞" by callers) when burn is zero or negative,
 * since the division is meaningless — not an error, just "not applicable".
 */
export function computeRunwayMonths(remaining: number, avgMonthlyBurn: number): number | null {
  if (!Number.isFinite(avgMonthlyBurn) || avgMonthlyBurn <= 0) return null;
  return remaining / avgMonthlyBurn;
}

export function isOverdue(
  date: string | Date | null | undefined,
  referenceDate: Date = new Date()
): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < referenceDate.getTime();
}

interface SecuredCashRecord {
  amount: number | string | Prisma.Decimal;
  verified: boolean;
  section: string;
}

/** SECURED sections — funding that counts toward the cash position at all. */
const SECURED_SECTIONS = ["FOUNDER", "LIVE"];

/**
 * Sum of verified FOUNDER + LIVE funding — the *committed* position. This is
 * money awarded to us, which is not the same as money in the bank; see
 * `computeCashPosition` for the banked figure that the runway should use.
 */
export function computeSecuredCash(records: SecuredCashRecord[]): number {
  return records
    .filter((r) => r.verified && SECURED_SECTIONS.includes(r.section))
    .reduce((s, r) => s + Number(r.amount), 0);
}

/**
 * Task-side spend for every cash calculation. Tasks track two separate pots —
 * `actualSpend` (internal) and `extCosts` (external/subcontracted) — and both
 * are real money out. Callers that summed only `actualSpend` understated burn
 * and disagreed with callers that summed both, so every path goes through here.
 */
export function computeTaskSpend(
  actualSpend: number | string | Prisma.Decimal | null | undefined,
  extCosts: number | string | Prisma.Decimal | null | undefined
): number {
  return Number(actualSpend ?? 0) + Number(extCosts ?? 0);
}

/**
 * Total spend for the runway calc: Task actuals (the primary cost-tracking
 * path) + Living Lab actuals + a manual historicalSpend adjustment for money
 * spent before this system was in use / outside either module's tracking + any
 * OUTGOING tranches already repaid (loan refunds are cash out too, and were
 * previously invisible to every spend total).
 *
 * `livingLabSpend` must be aggregated with `where: { taskId: null }`. Saving a
 * task mirrors its spend into a LivingLabCost row for every lab in the project,
 * so task-linked lab costs are duplicates of `taskSpend` — passing the
 * unfiltered lab total counts the same money once per lab.
 */
export function computeTotalSpend(
  taskSpend: number,
  livingLabSpend: number,
  historicalSpend: number,
  repaidOutflows = 0
): number {
  return taskSpend + livingLabSpend + historicalSpend + repaidOutflows;
}

interface CashPositionRecord extends SecuredCashRecord {
  tranches?: TrancheSummaryInput[];
}

export interface CashPosition {
  /** Verified FOUNDER+LIVE awards — money committed to us. */
  securedCash: number;
  /** The portion of `securedCash` actually received. Drives runway. */
  bankedCash: number;
  /** securedCash − bankedCash: awarded but not yet in the account. */
  awaitingReceipt: number;
  /** OUTGOING tranches already settled — cash that has left. */
  repaidOutflows: number;
  /** OUTGOING tranches still outstanding — cash committed to leave. */
  committedOutflows: number;
  /** The working behind securedCash vs bankedCash, for reconciliation. */
  trancheSummary: TrancheReconciliation;
}

export interface TrancheReconciliation {
  incomingScheduled: number;
  incomingReceived: number;
  incomingOutstanding: number;
  outgoingScheduled: number;
  outgoingRepaid: number;
  outgoingOutstanding: number;
  /** Award value not scheduled through any tranche — treated as already banked. */
  unscheduled: number;
  incomingCount: number;
  outgoingCount: number;
}

/**
 * Splits the funding book into what has actually landed versus what is merely
 * promised. A record with no INCOMING tranches is assumed banked in full (the
 * common case — tranche tracking is opt-in). Where tranches do exist, only the
 * RECEIVED ones count, plus any part of the award not scheduled through a
 * tranche at all, so partially-scheduled records aren't understated.
 */
export function computeCashPosition(records: CashPositionRecord[]): CashPosition {
  let securedCash = 0;
  let bankedCash = 0;
  let repaidOutflows = 0;
  let committedOutflows = 0;

  // Reconciliation detail — the line-by-line working behind securedCash vs
  // bankedCash, so the difference between them can be checked rather than
  // taken on trust.
  const t = {
    incomingScheduled: 0,
    incomingReceived: 0,
    incomingOutstanding: 0,
    outgoingScheduled: 0,
    outgoingRepaid: 0,
    outgoingOutstanding: 0,
    unscheduled: 0,
    incomingCount: 0,
    outgoingCount: 0,
  };

  for (const record of records) {
    const tranches = record.tranches ?? [];

    for (const tr of tranches) {
      if (tr.direction !== "OUTGOING") continue;
      const amount = Number(tr.amount);
      t.outgoingScheduled += amount;
      t.outgoingCount++;
      if (tr.status === "RECEIVED") {
        repaidOutflows += amount;
        t.outgoingRepaid += amount;
      } else {
        committedOutflows += amount;
        t.outgoingOutstanding += amount;
      }
    }

    if (!record.verified || !SECURED_SECTIONS.includes(record.section)) continue;

    const amount = Number(record.amount);
    securedCash += amount;

    const incoming = tranches.filter((tr) => (tr.direction ?? "INCOMING") === "INCOMING");
    if (incoming.length === 0) {
      bankedCash += amount;
      t.unscheduled += amount;
      continue;
    }

    const scheduled = incoming.reduce((s, tr) => s + Number(tr.amount), 0);
    const received = incoming
      .filter((tr) => tr.status === "RECEIVED")
      .reduce((s, tr) => s + Number(tr.amount), 0);
    const unscheduled = Math.max(0, amount - scheduled);

    t.incomingCount += incoming.length;
    t.incomingScheduled += scheduled;
    t.incomingReceived += received;
    t.incomingOutstanding += scheduled - received;
    t.unscheduled += unscheduled;

    bankedCash += received + unscheduled;
  }

  return {
    securedCash,
    bankedCash,
    awaitingReceipt: securedCash - bankedCash,
    repaidOutflows,
    committedOutflows,
    trancheSummary: t,
  };
}

/** Whole months elapsed from `from` to `to` (never negative). */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) -
    (to.getDate() < from.getDate() ? 1 : 0);
  return Math.max(0, months);
}

interface BurnWindowRecord {
  date?: Date | null;
  createdAt: Date;
}

/**
 * When the burn clock starts, for `totalSpend / activeMonths`.
 *
 * NOT `records[0].createdAt` — that's a row-insert timestamp, and the ODS
 * migration inserts every historical record in one run, so it collapses years
 * of trading into "since the import" and inflates monthly burn accordingly.
 * The project's own startDate is the real anchor; funding `date` (the economic
 * date, where set) is the fallback, and createdAt only the last resort.
 */
export function computeBurnWindowStart(
  projectStartDate: Date | null | undefined,
  records: BurnWindowRecord[],
  now: Date = new Date()
): Date {
  const candidates = [
    ...(projectStartDate ? [projectStartDate] : []),
    ...records.map((r) => r.date ?? r.createdAt),
  ].filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()) && d.getTime() <= now.getTime());

  if (candidates.length === 0) return now;
  return candidates.reduce((earliest, d) => (d < earliest ? d : earliest));
}

/**
 * The project-level inputs to runway for one project or several added up: the
 * earliest start date (the burn window opens with the first project) and the
 * historical-spend adjustments summed in pence.
 */
export function combineProjectBasis(
  projects: readonly { startDate: Date | null; historicalSpend: MoneyInput | null }[]
): { startDate: Date | null; historicalSpend: number } {
  const starts = projects.flatMap((p) => (p.startDate ? [p.startDate] : []));
  return {
    startDate: starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : null,
    historicalSpend: Number(fromPence(sumPence(projects.map((p) => toPenceOrZero(p.historicalSpend))))),
  };
}

/** Months the project has been burning, floored at 1 to keep the division safe. */
export function computeActiveMonths(windowStart: Date, now: Date = new Date()): number {
  return Math.max(1, monthsBetween(windowStart, now));
}

interface FundingForecastRecord {
  section: string;
  stage: string | null;
  amount: number | string | Prisma.Decimal;
  probability?: number | null;
  deadline: Date | null;
  nextActionDate: Date | null;
}

/**
 * Full pipeline forecast: weighted total, per-stage breakdown, upcoming
 * deadlines (14d), and overdue next-actions. Shared by the funding API route
 * and the Hermes `funding_forecast` tool so both stay in sync.
 */
export function computeFundingForecast<T extends FundingForecastRecord>(
  allRecords: T[],
  now: Date = new Date()
) {
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const pipeline = allRecords.filter(
    (r) => r.section === "PIPELINE" && isTrackedInPipeline(r.stage)
  );
  const openPipeline = pipeline.filter((r) => !isTerminalStage(r.stage) || r.stage === "AWARDED");

  const byStage = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => {
      // A pipeline record with no stage set belongs somewhere — bucket it under
      // PROSPECT rather than letting it fall out of every bucket, where it was
      // invisible on the board and missing from the per-stage totals.
      const recs = pipeline.filter((r) => (r.stage ?? "PROSPECT") === stage);
      return [
        stage,
        {
          count: recs.length,
          totalAmount: recs.reduce((s, r) => s + Number(r.amount), 0),
          weightedAmount: computeWeightedForecast(recs),
        },
      ];
    })
  );

  const upcomingDeadlines = pipeline
    .filter((r) => r.deadline && r.deadline >= now && r.deadline <= in14Days)
    .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime());

  const overdueNextActions = pipeline
    .filter((r) => r.nextActionDate && r.nextActionDate < now && !isTerminalStage(r.stage))
    .sort((a, b) => a.nextActionDate!.getTime() - b.nextActionDate!.getTime());

  return {
    // Weighted over `openPipeline`, not every pipeline record: the stage PATCH
    // only rewrites probability on AWARDED, so a bid dragged to REJECTED keeps
    // whatever probability it had and would otherwise contribute to the
    // forecast forever. Terminal-and-lost bids are worth zero by definition.
    weightedForecast: computeWeightedForecast(openPipeline),
    totalPipeline: openPipeline.reduce((s, r) => s + Number(r.amount), 0),
    byStage,
    upcomingDeadlines,
    overdueNextActions,
  };
}

interface UtilizationRecord {
  id: string;
  amount: number | string | Prisma.Decimal;
  phaseId: string | null;
}

export interface RecordUtilization {
  /** Spend attributed to this record, or null when it can't be attributed. */
  totalSpent: number | null;
  /** 0–1, or null when unattributable — callers render "—" rather than a bar. */
  utilization: number | null;
  isOverBudget: boolean;
}

/**
 * Attributes spend to individual funding records via the phase they fund.
 *
 * There is no direct Task→FundingRecord link, so the only honest attribution
 * path is FundingRecord.phaseId ← Milestone.phaseId ← Task. Where several
 * records fund the same phase, that phase's spend is split between them in
 * proportion to their amounts — otherwise each record would be charged the
 * full phase spend. A record with no phase can't be attributed at all and
 * returns null, which the UI shows as "—".
 *
 * (Previously every record was charged the entire project's spend, so any
 * project with more than one funding record showed most of them as "Over".)
 */
export function computePhaseUtilization(
  records: UtilizationRecord[],
  spendByPhase: Map<string, number>
): Map<string, RecordUtilization> {
  const fundingByPhase = new Map<string, number>();
  for (const r of records) {
    if (!r.phaseId) continue;
    fundingByPhase.set(r.phaseId, (fundingByPhase.get(r.phaseId) ?? 0) + Number(r.amount));
  }

  const result = new Map<string, RecordUtilization>();
  for (const r of records) {
    const amount = Number(r.amount);
    const phaseFunding = r.phaseId ? fundingByPhase.get(r.phaseId) ?? 0 : 0;

    if (!r.phaseId || phaseFunding <= 0 || amount <= 0) {
      result.set(r.id, { totalSpent: null, utilization: null, isOverBudget: false });
      continue;
    }

    const totalSpent = (spendByPhase.get(r.phaseId) ?? 0) * (amount / phaseFunding);
    result.set(r.id, {
      totalSpent,
      utilization: Math.min(totalSpent / amount, 1),
      isOverBudget: totalSpent > amount,
    });
  }
  return result;
}

export type TrancheDirection = "INCOMING" | "OUTGOING";

interface TrancheSummaryInput {
  amount: number | string | Prisma.Decimal;
  status: string;
  direction?: string | null;
}

function summarizeSettled(tranches: TrancheSummaryInput[]) {
  const settled = tranches.filter((t) => t.status === "RECEIVED");
  return {
    receivedCount: settled.length,
    totalCount: tranches.length,
    receivedAmount: settled.reduce((s, t) => s + Number(t.amount), 0),
    totalAmount: tranches.reduce((s, t) => s + Number(t.amount), 0),
  };
}

/**
 * "Received X of Y (£ of £)" aggregate for a funding record's tranches.
 * Tranches can flow either direction — INCOMING (grant installments still to
 * be received) or OUTGOING (loan/investment repayments still to be paid).
 * The top-level fields are a combined total (back-compat with callers that
 * don't care about direction); `.incoming`/`.outgoing` give the breakdown so
 * the UI can say "received" vs "repaid" correctly.
 */
export function summarizeTranches(tranches: TrancheSummaryInput[]) {
  const incoming = tranches.filter((t) => (t.direction ?? "INCOMING") === "INCOMING");
  const outgoing = tranches.filter((t) => t.direction === "OUTGOING");
  return {
    ...summarizeSettled(tranches),
    incoming: summarizeSettled(incoming),
    outgoing: summarizeSettled(outgoing),
  };
}
