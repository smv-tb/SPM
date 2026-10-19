export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { FUNDING_STAGE_META, isTerminalStage } from "@/lib/funding";
import {
  buildMonthlyCashFlow,
  computeTrailingBurn,
  projectCashOut,
  monthKey,
  type ScheduledFlow,
} from "@/lib/cash-ledger";
import { projectFilterForRequest } from "@/lib/current-project";

const HISTORY_MONTHS = 12;
const HORIZON_MONTHS = 24;

/**
 * Cash flow: where the money actually went, and when it runs out.
 *
 * Unlike /api/funding/analytics — which can only average total spend over the
 * project's life — this reads the dated ledger, so the history is real and the
 * forward projection accounts for *when* committed money lands. Pipeline
 * funding is included at its stage probability and can be toggled off with
 * `?pipeline=false` to see the contracted-only picture.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const where = await projectFilterForRequest(session.user.id, req);
  const includePipeline = req.nextUrl.searchParams.get("pipeline") !== "false";
  const now = new Date();

  const [entries, unsettledTranches, pipelineRecords] = await Promise.all([
    prisma.cashTransaction.findMany({
      where,
      select: { date: true, amount: true, direction: true },
      orderBy: { date: "asc" },
    }),
    prisma.fundingTranche.findMany({
      where: { status: { not: "RECEIVED" }, fundingRecord: where },
      include: { fundingRecord: { select: { fundName: true, section: true, stage: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.fundingRecord.findMany({
      where: { ...where, section: "PIPELINE", deadline: { not: null } },
    }),
  ]);

  // ── History: real movements, no averaging ────────────────────────────────
  const months: string[] = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }

  const windowStart = months[0];
  const priorNet = entries
    .filter((e) => monthKey(e.date) < windowStart)
    .reduce((s, e) => s + (e.direction === "IN" ? 1 : -1) * Number(e.amount), 0);

  const history = buildMonthlyCashFlow(entries, months, priorNet);
  const currentBalance = history.length > 0 ? history[history.length - 1].closingBalance : priorNet;

  // ── Burn: trailing actuals, falling back to the whole-ledger average ─────
  const trailingBurn = computeTrailingBurn(entries, now);
  const totalOut = entries
    .filter((e) => e.direction === "OUT")
    .reduce((s, e) => s + Number(e.amount), 0);
  const observedMonths = new Set(
    entries.filter((e) => e.direction === "OUT").map((e) => monthKey(e.date))
  ).size;
  const fallbackBurn = observedMonths > 0 ? totalOut / observedMonths : 0;
  const monthlyBurn = trailingBurn ?? fallbackBurn;

  // ── Scheduled flows: contracted first, pipeline weighted and optional ────
  const scheduled: ScheduledFlow[] = [];

  for (const t of unsettledTranches) {
    scheduled.push({
      // An overdue tranche hasn't stopped being owed — pull it to this month
      // rather than dropping it out of the projection entirely.
      date: t.dueDate < now ? now : t.dueDate,
      amount: Number(t.amount),
      direction: t.direction === "OUTGOING" ? "OUT" : "IN",
      probability: 1,
      label: `${t.fundingRecord.fundName} — ${t.label}`,
    });
  }

  if (includePipeline) {
    for (const r of pipelineRecords) {
      if (isTerminalStage(r.stage)) continue;
      const stageDefault = r.stage ? FUNDING_STAGE_META[r.stage].defaultProbability : 0;
      const probability = (r.probability ?? stageDefault) / 100;
      if (probability <= 0 || !r.deadline) continue;
      scheduled.push({
        // Money lands after a decision, not on the submission deadline. One
        // quarter is the working assumption and is surfaced in the response.
        date: new Date(r.deadline.getFullYear(), r.deadline.getMonth() + 3, 1),
        amount: Number(r.amount),
        direction: "IN",
        probability,
        label: r.fundName,
      });
    }
  }

  const projection = projectCashOut(currentBalance, monthlyBurn, scheduled, now, HORIZON_MONTHS);

  return NextResponse.json({
    currentBalance,
    monthlyBurn,
    burnMethod: trailingBurn != null ? "trailing-6-month-actuals" : "ledger-average",
    history,
    ...projection,
    includePipeline,
    pipelineLagMonths: 3,
    scheduledCount: scheduled.length,
    ledgerEntryCount: entries.length,
    upcomingFlows: scheduled
      .slice()
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 10)
      .map((f) => ({
        date: f.date,
        amount: f.amount,
        weightedAmount: f.amount * f.probability,
        direction: f.direction,
        probability: f.probability,
        label: f.label,
      })),
  });
});

/** Rebuilds the derived ledger from source entities. Safe to re-run. */
export const POST = withErrorHandler(async () => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:sync")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { syncCashLedger } = await import("@/lib/cash-ledger-sync");
  const result = await syncCashLedger();
  return NextResponse.json(result);
});
