export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { bankPosition } from "@/lib/accounting/statements";
import {
  computeFundingForecast,
  computeCashPosition,
  computeRunwayMonths,
  computeTaskSpend,
  computeTotalSpend,
  computeBurnWindowStart,
  computeActiveMonths,
  combineProjectBasis,
} from "@/lib/funding";
import { resolveProjectScope, projectWhere } from "@/lib/current-project";

const SERIES_MONTHS = 12;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await resolveProjectScope(session.user.id, {
    requested: req.nextUrl.searchParams.get("projectId"),
  });
  if (!scope || scope.kind !== "project") return NextResponse.json({ error: "No project" }, { status: 404 });
  const where = projectWhere(scope);
  const project = { id: scope.projectId, ...combineProjectBasis([scope.project]) };

  const now = new Date();
  const [fundingRecords, taskAgg, livingLabAgg, overdueTranches] = await Promise.all([
    prisma.fundingRecord.findMany({
      where,
      include: {
        tranches: { select: { amount: true, status: true, direction: true, receivedDate: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.task.aggregate({ where, _sum: { actualSpend: true, extCosts: true } }),
    // `taskId: null` is load-bearing. Updating a task's spend mirrors it into a
    // LivingLabCost row for every lab in the project (tasks/[id]/route.ts), so
    // task-linked lab costs are copies of money already counted in taskSpend —
    // and with N labs the same spend is copied N times. Only lab costs that
    // originate in the Living Lab module itself are additional.
    prisma.livingLabCost.aggregate({ where: { taskId: null, lab: where }, _sum: { actualSpend: true } }),
    prisma.fundingTranche.findMany({
      where: { status: { not: "RECEIVED" }, dueDate: { lt: now }, fundingRecord: where },
      include: { fundingRecord: { select: { fundName: true } } },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  // Committed (awarded) vs banked (actually received) are different numbers —
  // runway must be driven by the banked figure, or an unreceived tranche is
  // simultaneously flagged overdue below and spent above.
  const cash = computeCashPosition(fundingRecords);
  const taskSpend = computeTaskSpend(taskAgg._sum.actualSpend, taskAgg._sum.extCosts);
  const livingLabSpend = Number(livingLabAgg._sum.actualSpend ?? 0);
  const historicalSpend = project.historicalSpend;
  const totalSpend = computeTotalSpend(
    taskSpend,
    livingLabSpend,
    historicalSpend,
    cash.repaidOutflows
  );
  const remaining = cash.bankedCash - totalSpend;

  const { weightedForecast } = computeFundingForecast(fundingRecords, now);

  const burnWindowStart = computeBurnWindowStart(project.startDate, fundingRecords, now);
  const activeMonths = computeActiveMonths(burnWindowStart, now);
  const avgMonthlyBurn = totalSpend / activeMonths;
  const runwayMonths = computeRunwayMonths(remaining, avgMonthlyBurn);

  // Trailing N-month series: real cash-in per month, burn approximated flat at
  // the average rate computed above. The schema has no dated spend ledger —
  // Task tracks a running actualSpend total, not per-period transactions — so a
  // true monthly burn curve isn't derivable; this is documented via burnMethod.
  //
  // Cash-in is dated the same way bankedCash is counted: a received INCOMING
  // tranche lands on its receivedDate, and an award with no tranche schedule
  // lands whole on its funding date. Anything else and the chart's own totals
  // contradict the KPI row above it.
  const cashInByMonth = new Map<string, number>();
  const addCashIn = (d: Date, amount: number) => {
    const key = monthKey(d);
    cashInByMonth.set(key, (cashInByMonth.get(key) ?? 0) + amount);
  };

  for (const r of fundingRecords) {
    if (!r.verified || (r.section !== "FOUNDER" && r.section !== "LIVE")) continue;
    const incoming = r.tranches.filter((t) => t.direction === "INCOMING");
    if (incoming.length === 0) {
      addCashIn(r.date ?? r.createdAt, Number(r.amount));
      continue;
    }
    for (const t of incoming) {
      if (t.status === "RECEIVED") addCashIn(t.receivedDate ?? r.date ?? r.createdAt, Number(t.amount));
    }
    // The slice of the award never scheduled through a tranche is treated as
    // banked on the record's own date — matching computeCashPosition.
    const unscheduled = Number(r.amount) - incoming.reduce((s, t) => s + Number(t.amount), 0);
    if (unscheduled > 0) addCashIn(r.date ?? r.createdAt, unscheduled);
  }

  const months: string[] = [];
  for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }

  // Both cumulative lines are seeded with everything that happened before the
  // visible window, so the series *ends* at the same securedCash/totalSpend the
  // KPI row shows. Without the seed the chart restarted at zero and its
  // cash-vs-spend crossover was meaningless.
  const burnWindowStartKey = monthKey(burnWindowStart);
  const burnMonthsInWindow = months.filter((m) => m >= burnWindowStartKey).length;
  const cashInWindow = months.reduce((s, m) => s + (cashInByMonth.get(m) ?? 0), 0);

  let cumulativeCashIn = Math.max(0, cash.bankedCash - cashInWindow);
  let cumulativeSpend = Math.max(0, totalSpend - burnMonthsInWindow * avgMonthlyBurn);
  const openingCashIn = cumulativeCashIn;
  const openingSpend = cumulativeSpend;

  const monthlySeries = months.map((month) => {
    const cashIn = cashInByMonth.get(month) ?? 0;
    // No burn attributed to months before the project was running.
    const burn = month >= burnWindowStartKey ? avgMonthlyBurn : 0;
    cumulativeCashIn += cashIn;
    cumulativeSpend += burn;
    return { month, cashIn, burn, cumulativeCashIn, cumulativeSpend };
  });

  // What is actually in the bank, from Books → Bank: each account's latest
  // imported statement balance (what the bank says), or its ledger balance
  // where no statement has been imported. Books data, so only for those who
  // can see the books; everyone else gets null and the tile says why.
  let bank: { balance: number; asOf: string | null; accounts: number; fromStatement: boolean } | null = null;
  if (hasPermission(session, "books:view")) {
    const accounts = await prisma.bankAccount.findMany({ where: { isArchived: false } });
    if (accounts.length > 0) {
      const positions = await Promise.all(accounts.map((a) => bankPosition(prisma, a)));
      const pence = positions.reduce((s, p) => s + (p.statementBalance ?? p.booksBalance), 0);
      const dates = positions.flatMap((p) => (p.statementDate ? [p.statementDate] : [])).sort();
      bank = {
        balance: pence / 100,
        // The oldest statement date: the total is only as current as that.
        asOf: dates[0] ?? null,
        accounts: accounts.length,
        fromStatement: positions.every((p) => p.statementBalance !== null),
      };
    }
  }

  return NextResponse.json({
    bank,
    canSeeBank: hasPermission(session, "books:view"),
    securedCash: cash.securedCash,
    bankedCash: cash.bankedCash,
    awaitingReceipt: cash.awaitingReceipt,
    committedOutflows: cash.committedOutflows,
    repaidOutflows: cash.repaidOutflows,
    trancheSummary: cash.trancheSummary,
    totalSpend,
    taskSpend,
    livingLabSpend,
    historicalSpend,
    projectId: project.id,
    remaining,
    avgMonthlyBurn,
    runwayMonths,
    weightedForecast,
    monthlySeries,
    burnMethod: "average",
    burnWindowStart,
    activeMonths,
    // Carried-in balances so a reader can see the chart is a window on a longer
    // history rather than the whole story.
    openingCashIn,
    openingSpend,
    overdueTranches: overdueTranches.map((t) => ({
      id: t.id,
      label: t.label,
      dueDate: t.dueDate,
      amount: Number(t.amount),
      fundName: t.fundingRecord.fundName,
      direction: t.direction,
    })),
  });
});
