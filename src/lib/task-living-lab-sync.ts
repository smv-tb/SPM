import type { Prisma } from "@prisma/client";

/**
 * Mirrors a task's budget and spend into a `LivingLabCost` row for every lab
 * in its project (one row per lab, keyed on taskId + labId).
 *
 * These mirrored rows are why any spend aggregate over `livingLabCost` must
 * filter `taskId: null` — see AGENTS.md. Shared by the task PATCH route and the
 * Hermes task tools so the two cannot drift.
 */
export async function syncTaskLivingLabCosts(
  tx: Prisma.TransactionClient,
  task: {
    id: string;
    projectId: string;
    costCategoryId: string | null;
    estBudget: Prisma.Decimal | null;
    actualSpend: Prisma.Decimal | null;
    startDate: Date;
  }
): Promise<void> {
  const livingLabs = await tx.livingLab.findMany({ where: { projectId: task.projectId }, select: { id: true } });
  if (livingLabs.length === 0) return;

  const costData = {
    costCategoryId: task.costCategoryId ?? null,
    estBudget: task.estBudget ?? 0,
    actualSpend: task.actualSpend ?? 0,
    startDate: task.startDate,
  };

  for (const lab of livingLabs) {
    const existing = await tx.livingLabCost.findFirst({ where: { taskId: task.id, labId: lab.id } });
    if (existing) {
      await tx.livingLabCost.update({ where: { id: existing.id }, data: { ...costData } });
    } else {
      await tx.livingLabCost.create({ data: { ...costData, labId: lab.id, taskId: task.id } });
    }
  }
}
