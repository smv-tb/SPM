import type { Prisma } from "@prisma/client";

/**
 * The cash ledger: dated money movements, derived from the entities that
 * already exist (tranches, awards, tasks, Living Lab costs) plus manual
 * entries.
 *
 * Why derive rather than ask people to enter transactions? Because the source
 * data is already there and re-typing it would guarantee the two drift apart.
 * Everything here is a pure function over rows so it can be tested without a
 * database; `syncCashLedger` in the API layer does the upserting.
 */

export type CashDirection = "IN" | "OUT";
export type CashSourceType = "TRANCHE" | "FUNDING_RECORD" | "TASK" | "LIVING_LAB" | "MANUAL";

export interface DerivedTransaction {
  projectId: string;
  date: Date;
  amount: number;
  direction: CashDirection;
  description: string;
  costCategoryId: string | null;
  phaseId: string | null;
  milestoneId: string | null;
  sourceType: CashSourceType;
  sourceId: string;
}

type Money = number | string | Prisma.Decimal;

interface TrancheRow {
  id: string;
  label: string;
  amount: Money;
  status: string;
  direction: string;
  receivedDate: Date | null;
  dueDate: Date;
  milestoneId: string | null;
  fundingRecord: {
    projectId: string;
    fundName: string;
    phaseId: string | null;
    date: Date | null;
    createdAt: Date;
  };
}

interface FundingRecordRow {
  id: string;
  projectId: string;
  fundName: string;
  amount: Money;
  verified: boolean;
  section: string;
  phaseId: string | null;
  date: Date | null;
  createdAt: Date;
  tranches: { amount: Money; direction: string }[];
}

interface TaskRow {
  id: string;
  projectId: string;
  code: string;
  title: string;
  actualSpend: Money | null;
  extCosts: Money | null;
  costCategoryId: string | null;
  milestoneId: string;
  startDate: Date;
  dueDate: Date;
  updatedAt: Date;
  milestone: { phaseId: string | null } | null;
}

interface LivingLabCostRow {
  id: string;
  taskId: string | null;
  actualSpend: Money;
  costCategoryId: string | null;
  milestoneId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  lab: { projectId: string; name: string };
}

/**
 * A settled tranche is the cleanest cash event in the system: a known amount on
 * a known date, in a known direction. INCOMING receipts are cash in, OUTGOING
 * repayments are cash out. Unsettled tranches are *forecast*, not ledger — they
 * belong to `projectCashFlow`, not here.
 */
export function deriveTrancheTransactions(tranches: TrancheRow[]): DerivedTransaction[] {
  return tranches
    .filter((t) => t.status === "RECEIVED")
    .map((t) => {
      const incoming = t.direction !== "OUTGOING";
      return {
        projectId: t.fundingRecord.projectId,
        // receivedDate is set whenever a tranche is marked settled; dueDate is
        // only a fallback for rows settled before that field was populated.
        date: t.receivedDate ?? t.dueDate,
        amount: Math.abs(Number(t.amount)),
        direction: (incoming ? "IN" : "OUT") as CashDirection,
        description: `${t.fundingRecord.fundName} — ${t.label}`,
        costCategoryId: null,
        phaseId: t.fundingRecord.phaseId,
        milestoneId: t.milestoneId,
        sourceType: "TRANCHE" as const,
        sourceId: t.id,
      };
    });
}

/**
 * The part of a verified award that arrives without a tranche schedule. Mirrors
 * `computeCashPosition`: tranches take precedence, and only the unscheduled
 * remainder is booked against the record itself — otherwise an award with
 * tranches would be counted twice.
 */
export function deriveFundingRecordTransactions(
  records: FundingRecordRow[]
): DerivedTransaction[] {
  const out: DerivedTransaction[] = [];

  for (const r of records) {
    if (!r.verified || (r.section !== "FOUNDER" && r.section !== "LIVE")) continue;

    const scheduled = r.tranches
      .filter((t) => t.direction !== "OUTGOING")
      .reduce((s, t) => s + Number(t.amount), 0);
    const unscheduled = Number(r.amount) - scheduled;
    if (unscheduled <= 0) continue;

    out.push({
      projectId: r.projectId,
      date: r.date ?? r.createdAt,
      amount: unscheduled,
      direction: "IN",
      description: r.fundName,
      costCategoryId: null,
      phaseId: r.phaseId,
      milestoneId: null,
      sourceType: "FUNDING_RECORD",
      sourceId: r.id,
    });
  }

  return out;
}

/**
 * Task spend as a cash event.
 *
 * Task.actualSpend is a running total with no date attached, so the best
 * available date is the task's own schedule — its dueDate if that has passed
 * (the work is done, the money is spent), otherwise its startDate. This is an
 * approximation and is labelled as one; it is still far better than spreading
 * every cost evenly across the project's life, which is what the flat-average
 * burn did.
 */
export function deriveTaskTransactions(tasks: TaskRow[], now: Date = new Date()): DerivedTransaction[] {
  const out: DerivedTransaction[] = [];

  for (const t of tasks) {
    const amount = Number(t.actualSpend ?? 0) + Number(t.extCosts ?? 0);
    if (amount <= 0) continue;

    out.push({
      projectId: t.projectId,
      date: t.dueDate <= now ? t.dueDate : t.startDate,
      amount,
      direction: "OUT",
      description: `${t.code} — ${t.title}`,
      costCategoryId: t.costCategoryId,
      phaseId: t.milestone?.phaseId ?? null,
      milestoneId: t.milestoneId,
      sourceType: "TASK",
      sourceId: t.id,
    });
  }

  return out;
}

/**
 * Living Lab costs that are genuinely their own spend.
 *
 * Rows with a `taskId` are mirrors: saving a task copies its spend into a
 * LivingLabCost row for every lab in the project, so counting them here would
 * duplicate `deriveTaskTransactions` — once per lab. Only standalone rows are
 * real, additional cash out.
 */
export function deriveLivingLabTransactions(
  costs: LivingLabCostRow[],
  now: Date = new Date()
): DerivedTransaction[] {
  const out: DerivedTransaction[] = [];

  for (const c of costs) {
    if (c.taskId) continue;
    const amount = Number(c.actualSpend);
    if (amount <= 0) continue;

    const end = c.endDate;
    out.push({
      projectId: c.lab.projectId,
      date: (end && end <= now ? end : c.startDate) ?? now,
      amount,
      direction: "OUT",
      description: `${c.lab.name} — lab cost`,
      costCategoryId: c.costCategoryId,
      phaseId: null,
      milestoneId: c.milestoneId,
      sourceType: "LIVING_LAB",
      sourceId: c.id,
    });
  }

  return out;
}

// ─── Reporting over the ledger ──────────────────────────────────────────────

export interface LedgerEntry {
  date: Date;
  amount: Money;
  direction: string;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface MonthlyCashPoint {
  month: string;
  cashIn: number;
  cashOut: number;
  net: number;
  closingBalance: number;
}

/**
 * Real monthly cash flow from the ledger — no averaging. `openingBalance` is
 * the cash position at the start of the first month in the series.
 */
export function buildMonthlyCashFlow(
  entries: LedgerEntry[],
  months: string[],
  openingBalance = 0
): MonthlyCashPoint[] {
  const inByMonth = new Map<string, number>();
  const outByMonth = new Map<string, number>();

  for (const e of entries) {
    const key = monthKey(e.date);
    const target = e.direction === "IN" ? inByMonth : outByMonth;
    target.set(key, (target.get(key) ?? 0) + Number(e.amount));
  }

  let balance = openingBalance;
  return months.map((month) => {
    const cashIn = inByMonth.get(month) ?? 0;
    const cashOut = outByMonth.get(month) ?? 0;
    const net = cashIn - cashOut;
    balance += net;
    return { month, cashIn, cashOut, net, closingBalance: balance };
  });
}

/**
 * Trailing burn: average monthly cash *out* over the last N complete months.
 *
 * Deliberately excludes the current partial month — a project three days into
 * the month would otherwise look like its burn had collapsed. Returns null when
 * there is no outflow history to average, which callers render as "—" rather
 * than pretending burn is zero.
 */
export function computeTrailingBurn(
  entries: LedgerEntry[],
  now: Date = new Date(),
  windowMonths = 6
): number | null {
  const months: string[] = [];
  for (let i = windowMonths; i >= 1; i--) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  const window = new Set(months);

  let total = 0;
  let seen = false;
  for (const e of entries) {
    if (e.direction !== "OUT") continue;
    if (!window.has(monthKey(e.date))) continue;
    total += Number(e.amount);
    seen = true;
  }

  if (!seen) return null;
  return total / windowMonths;
}

export interface ScheduledFlow {
  date: Date;
  amount: number;
  direction: CashDirection;
  /** 1 for contracted money, <1 for weighted pipeline. */
  probability: number;
  label: string;
}

export interface CashOutProjection {
  /** The month the balance first goes negative, or null if it never does. */
  cashOutMonth: string | null;
  /** Months from now until that point, or null. */
  monthsRemaining: number | null;
  projection: {
    month: string;
    openingBalance: number;
    scheduledIn: number;
    scheduledOut: number;
    burn: number;
    closingBalance: number;
  }[];
}

/**
 * Forward projection: today's balance, minus burn, plus scheduled inflows and
 * minus scheduled outflows, month by month, until the balance goes negative.
 *
 * This is the number the flat-average runway could never give — it accounts for
 * *when* money is due, not just how much there is. A grant landing in month 4
 * moves the cash-out date; a £60k repayment due next month brings it forward.
 *
 * Pipeline money can be included at its weighted probability, which is why
 * `ScheduledFlow` carries one: contracted tranches are 1, a 40%-likely grant
 * contributes 40% of its value. Callers decide whether to pass pipeline at all.
 */
export function projectCashOut(
  openingBalance: number,
  monthlyBurn: number,
  scheduled: ScheduledFlow[],
  now: Date = new Date(),
  horizonMonths = 24
): CashOutProjection {
  const inByMonth = new Map<string, number>();
  const outByMonth = new Map<string, number>();

  for (const f of scheduled) {
    const key = monthKey(f.date);
    const weighted = f.amount * f.probability;
    const target = f.direction === "IN" ? inByMonth : outByMonth;
    target.set(key, (target.get(key) ?? 0) + weighted);
  }

  const projection: CashOutProjection["projection"] = [];
  let balance = openingBalance;
  let cashOutMonth: string | null = null;
  let monthsRemaining: number | null = null;

  for (let i = 0; i < horizonMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = monthKey(d);
    const opening = balance;
    const scheduledIn = inByMonth.get(month) ?? 0;
    const scheduledOut = outByMonth.get(month) ?? 0;

    balance = opening + scheduledIn - scheduledOut - monthlyBurn;
    projection.push({
      month,
      openingBalance: opening,
      scheduledIn,
      scheduledOut,
      burn: monthlyBurn,
      closingBalance: balance,
    });

    // Anything already overdrawn is reported at month 0 rather than skipped.
    if (balance < 0 && cashOutMonth === null) {
      cashOutMonth = month;
      monthsRemaining = i;
    }
  }

  return { cashOutMonth, monthsRemaining, projection };
}
