export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { computeVariance, groupVariance, summarizeVariance } from "@/lib/variance";
import { computeTaskSpend } from "@/lib/funding";
import { projectFilterForRequest } from "@/lib/current-project";

type Dimension = "phase" | "milestone" | "category" | "task";

const DIMENSIONS: Dimension[] = ["phase", "milestone", "category", "task"];

/**
 * Budget vs actual, sliced by phase, milestone, cost category or task.
 *
 * Actuals come from the task rows rather than the cash ledger: the ledger dates
 * spend by proxy (a task has no transaction date of its own), which is right for
 * cash flow but would make a budget comparison depend on scheduling. Budget vs
 * actual asks "did this cost what we said" — a question about totals, not dates.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const where = await projectFilterForRequest(session.user.id, req);

  const requested = req.nextUrl.searchParams.get("by") as Dimension | null;
  const by: Dimension = requested && DIMENSIONS.includes(requested) ? requested : "phase";

  const tasks = await prisma.task.findMany({
    where,
    select: {
      id: true,
      code: true,
      title: true,
      estBudget: true,
      actualSpend: true,
      extCosts: true,
      costCategoryId: true,
      milestoneId: true,
      milestone: { select: { id: true, code: true, title: true, phaseId: true } },
    },
  });

  // extCosts counts toward both sides: it is budgeted external work and it is
  // money spent. Matches computeTaskSpend and the milestone budget rollup.
  const rows = tasks.map((t) => ({
    task: t,
    estBudget: Number(t.estBudget ?? 0) + Number(t.extCosts ?? 0),
    actualSpend: computeTaskSpend(t.actualSpend, t.extCosts),
  }));

  let variance;

  if (by === "task") {
    variance = computeVariance(
      rows.map((r) => ({
        id: r.task.id,
        name: `${r.task.code} — ${r.task.title}`,
        estBudget: r.estBudget,
        actualSpend: r.actualSpend,
      }))
    ).sort((a, b) => a.variance - b.variance);
  } else if (by === "milestone") {
    const names = new Map(
      tasks
        .filter((t) => t.milestone)
        .map((t) => [t.milestone!.id, `${t.milestone!.code} — ${t.milestone!.title}`])
    );
    variance = groupVariance(
      rows.map((r) => ({ groupId: r.task.milestoneId, ...r })),
      names,
      "No milestone"
    );
  } else if (by === "category") {
    const categories = await prisma.costCategory.findMany({ select: { id: true, name: true } });
    variance = groupVariance(
      rows.map((r) => ({ groupId: r.task.costCategoryId, ...r })),
      new Map(categories.map((c) => [c.id, c.name])),
      "Uncategorised"
    );
  } else {
    const phases = await prisma.phase.findMany({ where, select: { id: true, name: true } });
    variance = groupVariance(
      rows.map((r) => ({ groupId: r.task.milestone?.phaseId ?? null, ...r })),
      new Map(phases.map((p) => [p.id, p.name])),
      "No phase"
    );
  }

  return NextResponse.json({
    by,
    rows: variance,
    totals: summarizeVariance(variance),
    dimensions: DIMENSIONS,
  });
});
