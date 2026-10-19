import { prisma } from "@/lib/prisma";
import {
  computeCashPosition,
  computeRunwayMonths,
  computeTaskSpend,
  computeTotalSpend,
  computeBurnWindowStart,
  computeActiveMonths,
  combineProjectBasis,
} from "@/lib/funding";
import { projectWhere, type ProjectScope } from "@/lib/current-project";

/** One project, or every active project added up ("All projects"). */
export async function getDashboardData(scope: ProjectScope) {
  const where = projectWhere(scope);
  const inScope = scope.kind === "project" ? [scope.project] : scope.projects;
  const project = combineProjectBasis(inScope);
  const [taskGroups, milestones, budgetAgg, livingLabAgg, fundingRecords, upcomingDeadline] = await Promise.all([
    prisma.task.groupBy({ by: ["status"], where, _count: { status: true } }),
    prisma.milestone.findMany({
      where: { ...where, parentId: null },
      include: {
        tasks: { select: { percentDone: true, status: true } },
        phase: { select: { name: true } },
        children: {
          include: { tasks: { select: { percentDone: true, status: true } } },
        },
      },
      orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
    }),
    prisma.task.aggregate({ where, _sum: { estBudget: true, actualSpend: true, extCosts: true } }),
    // Only lab costs NOT mirrored from a task — see the note in the funding
    // analytics route; task-linked rows duplicate taskSpend, once per lab.
    prisma.livingLabCost.aggregate({ where: { taskId: null, lab: where }, _sum: { actualSpend: true } }),
    prisma.fundingRecord.findMany({
      where,
      include: { tranches: { select: { amount: true, status: true, direction: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.fundingRecord.findFirst({
      where: { ...where, section: "PIPELINE", deadline: { gte: new Date() } },
      orderBy: { deadline: "asc" },
      select: { deadline: true },
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const g of taskGroups) statusMap[g.status] = g._count.status;
  const totalTasks = Object.values(statusMap).reduce((a, b) => a + b, 0);

  // Every input here must match the funding analytics route exactly, or the
  // dashboard and the funding page show two different runways for one project.
  const now = new Date();
  const cash = computeCashPosition(fundingRecords);
  const totalFunding = cash.securedCash;
  const totalActualSpend = Number(budgetAgg._sum.actualSpend ?? 0);
  // Runway burns through more than just Task actuals — external costs, Living
  // Lab costs, repaid loans and the manual historical adjustment all count.
  const totalSpendForRunway = computeTotalSpend(
    computeTaskSpend(budgetAgg._sum.actualSpend, budgetAgg._sum.extCosts),
    Number(livingLabAgg._sum.actualSpend ?? 0),
    project.historicalSpend,
    cash.repaidOutflows
  );
  const activeMonths = computeActiveMonths(
    computeBurnWindowStart(project.startDate, fundingRecords, now),
    now
  );
  const avgMonthlyBurn = totalSpendForRunway / activeMonths;
  const runwayMonths = computeRunwayMonths(cash.bankedCash - totalSpendForRunway, avgMonthlyBurn);

  return {
    kpis: {
      totalTasks,
      done: statusMap["DONE"] ?? 0,
      inProgress: statusMap["IN_PROGRESS"] ?? 0,
      blocked: statusMap["BLOCKED"] ?? 0,
      overdue: statusMap["OVERDUE"] ?? 0,
      totalEstBudget: Number(budgetAgg._sum.estBudget ?? 0),
      totalActualSpend,
      totalFunding,
      runwayMonths,
      nextFundingDeadline: upcomingDeadline?.deadline ?? null,
    },
    milestones: milestones.map((m) => {
      const allTasks = [...m.tasks, ...m.children.flatMap((c) => c.tasks)];
      const taskCount = allTasks.length;
      const pct = taskCount > 0
        ? Math.round(allTasks.reduce((s, t) => s + t.percentDone, 0) / taskCount)
        : 0;
      const doneTasks = allTasks.filter((t) => t.status === "DONE").length;
      return {
        id: m.id, code: m.code, title: m.title, status: m.status, priority: m.priority,
        dueDate: m.dueDate, taskCount, doneTasks, percentComplete: pct,
        estBudget: Number(m.estBudget ?? 0), actualSpend: Number(m.actualSpend ?? 0),
        phase: m.phase?.name ?? null,
      };
    }),
  };
}

export async function getDashboardDataForApi(where: { projectId: string | { in: string[] } }) {
  const [taskCounts, milestones, budgetAgg] = await Promise.all([
    prisma.task.groupBy({
      by: ["status"],
      where,
      _count: { status: true },
    }),
    prisma.milestone.findMany({
      where,
      include: {
        tasks: { select: { percentDone: true, status: true } },
        phase: { select: { name: true, color: true } },
      },
      orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
    }),
    prisma.task.aggregate({
      where,
      _sum: { estBudget: true, actualSpend: true },
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const g of taskCounts) {
    statusMap[g.status] = g._count.status;
  }

  const totalTasks = Object.values(statusMap).reduce((a, b) => a + b, 0);
  const done = statusMap["DONE"] ?? 0;
  const inProgress = statusMap["IN_PROGRESS"] ?? 0;
  const blocked = statusMap["BLOCKED"] ?? 0;
  const overdue = statusMap["OVERDUE"] ?? 0;

  const totalEstBudget = Number(budgetAgg._sum.estBudget ?? 0);
  const totalActualSpend = Number(budgetAgg._sum.actualSpend ?? 0);

  const milestoneRows = milestones.map((m) => {
    const taskCount = m.tasks.length;
    const doneTasks = m.tasks.filter((t) => t.status === "DONE").length;
    const avgPct = taskCount > 0
      ? Math.round(m.tasks.reduce((s, t) => s + t.percentDone, 0) / taskCount)
      : 0;
    return {
      id: m.id,
      code: m.code,
      title: m.title,
      status: m.status,
      priority: m.priority,
      dueDate: m.dueDate,
      taskCount,
      doneTasks,
      percentComplete: avgPct,
      estBudget: Number(m.estBudget ?? 0),
      actualSpend: Number(m.actualSpend ?? 0),
      phase: m.phase?.name ?? null,
    };
  });

  return {
    kpis: { totalTasks, done, inProgress, blocked, overdue, totalEstBudget, totalActualSpend },
    milestones: milestoneRows,
  };
}
