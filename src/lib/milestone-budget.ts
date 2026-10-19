import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * A client type that accepts both the global prisma and a transaction client.
 */
type PrismaClientLike = typeof prisma | Prisma.TransactionClient;

/**
 * Update milestone budget totals based on all tasks in the milestone.
 * Calculates:
 * - estBudget: SUM(task.estBudget) + SUM(task.extCosts)
 * - actualSpend: SUM(task.actualSpend) + SUM(task.extCosts)
 *
 * Iteratively walks up the parent chain and updates all ancestors.
 */
export async function updateMilestoneBudget(milestoneId: string): Promise<void> {
  // Collect all ancestors by walking up the parent chain
  const ancestorIds: string[] = [];
  let currentId: string | null = milestoneId;

  // Get the target milestone's parent first
  const self = await prisma.milestone.findUnique({
    where: { id: currentId },
    select: { parentId: true },
  });

  currentId = self?.parentId ?? null;
  while (currentId) {
    ancestorIds.push(currentId);
    const ms = await prisma.milestone.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = ms?.parentId ?? null;
  }

  // Update the target milestone and each ancestor
  const idsToUpdate = [milestoneId, ...ancestorIds];
  for (const id of idsToUpdate) {
    await recalcSingleMilestoneBudget(prisma, id);
  }
}

/**
 * Transactional variant — accepts a transaction client instead of using the global prisma.
 */
export async function updateMilestoneBudgetInTx(
  tx: Prisma.TransactionClient,
  milestoneId: string
): Promise<void> {
  // Collect ancestors
  const ancestorIds: string[] = [];
  let currentId: string | null = milestoneId;

  const self = await tx.milestone.findUnique({
    where: { id: currentId },
    select: { parentId: true },
  });

  currentId = self?.parentId ?? null;
  while (currentId) {
    ancestorIds.push(currentId);
    const ms = await tx.milestone.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = ms?.parentId ?? null;
  }

  // Update all
  const idsToUpdate = [milestoneId, ...ancestorIds];
  for (const id of idsToUpdate) {
    await recalcSingleMilestoneBudget(tx, id);
  }
}

/**
 * Update budgets for multiple milestones at once.
 * Useful when a task is moved from one milestone to another.
 */
export async function updateMultipleMilestoneBudgets(milestoneIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(milestoneIds)];
  for (const id of uniqueIds) {
    await updateMilestoneBudget(id);
  }
}

/**
 * Transactional variant of updateMultipleMilestoneBudgets.
 */
export async function updateMultipleMilestoneBudgetsInTx(
  tx: Prisma.TransactionClient,
  milestoneIds: string[]
): Promise<void> {
  const uniqueIds = [...new Set(milestoneIds)];
  for (const id of uniqueIds) {
    await updateMilestoneBudgetInTx(tx, id);
  }
}

/**
 * Recalculate and persist the budget for a single milestone ID.
 * Looks at its own tasks + direct child milestones.
 */
async function recalcSingleMilestoneBudget(
  client: PrismaClientLike,
  milestoneId: string
): Promise<void> {
  const milestone = await client.milestone.findUnique({
    where: { id: milestoneId },
    include: {
      tasks: {
        select: { estBudget: true, actualSpend: true, extCosts: true },
      },
      children: {
        select: { id: true, estBudget: true, actualSpend: true },
      },
    },
  });

  if (!milestone) return;

  // Calculate totals from direct tasks
  let totalEstBudget = 0;
  let totalActualSpend = 0;

  for (const task of milestone.tasks) {
    totalEstBudget += Number(task.estBudget ?? 0) + Number(task.extCosts ?? 0);
    totalActualSpend += Number(task.actualSpend ?? 0) + Number(task.extCosts ?? 0);
  }

  // Add totals from child milestones (use their stored aggregate,
  // which already includes their own children's budgets recursively)
  for (const child of milestone.children) {
    totalEstBudget += Number(child.estBudget ?? 0);
    totalActualSpend += Number(child.actualSpend ?? 0);
  }

  // Update the milestone
  await client.milestone.update({
    where: { id: milestoneId },
    data: {
      estBudget: totalEstBudget > 0 ? totalEstBudget : null,
      actualSpend: totalActualSpend > 0 ? totalActualSpend : null,
    },
  });
}
