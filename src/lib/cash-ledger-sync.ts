import { prisma } from "@/lib/prisma";
import {
  deriveTrancheTransactions,
  deriveFundingRecordTransactions,
  deriveTaskTransactions,
  deriveLivingLabTransactions,
  type DerivedTransaction,
} from "@/lib/cash-ledger";

/**
 * Rebuilds the derived half of the cash ledger from the source entities.
 *
 * Idempotent by design: every derived row is keyed on (sourceType, sourceId),
 * so a re-run updates in place rather than accumulating duplicates. Rows whose
 * source has gone away (a deleted task, a tranche reverted to PENDING) are
 * removed. MANUAL entries are never touched — they are the one thing here that
 * a human owns.
 */
export async function syncCashLedger(now: Date = new Date()): Promise<{
  created: number;
  updated: number;
  deleted: number;
}> {
  // Archived projects are read-only (a database trigger refuses writes), so
  // their derived rows are left exactly as they were: neither rebuilt nor
  // treated as stale.
  const live = { archivedAt: null };
  const [tranches, fundingRecords, tasks, labCosts] = await Promise.all([
    prisma.fundingTranche.findMany({
      where: { fundingRecord: { project: live } },
      include: {
        fundingRecord: {
          select: { projectId: true, fundName: true, phaseId: true, date: true, createdAt: true },
        },
      },
    }),
    prisma.fundingRecord.findMany({
      where: { project: live },
      include: { tranches: { select: { amount: true, direction: true } } },
    }),
    prisma.task.findMany({ where: { project: live }, include: { milestone: { select: { phaseId: true } } } }),
    prisma.livingLabCost.findMany({
      where: { lab: { project: live } },
      include: { lab: { select: { projectId: true, name: true } } },
    }),
  ]);

  const derived: DerivedTransaction[] = [
    ...deriveTrancheTransactions(tranches),
    ...deriveFundingRecordTransactions(fundingRecords),
    ...deriveTaskTransactions(tasks, now),
    ...deriveLivingLabTransactions(labCosts, now),
  ];

  const existing = await prisma.cashTransaction.findMany({
    where: { sourceType: { not: "MANUAL" }, project: live },
    select: { id: true, sourceType: true, sourceId: true },
  });

  const key = (sourceType: string, sourceId: string | null) => `${sourceType}:${sourceId}`;
  const wanted = new Set(derived.map((d) => key(d.sourceType, d.sourceId)));

  let created = 0;
  let updated = 0;

  const existingKeys = new Set(existing.map((e) => key(e.sourceType, e.sourceId)));

  for (const d of derived) {
    const payload = {
      projectId: d.projectId,
      date: d.date,
      amount: d.amount,
      direction: d.direction,
      description: d.description,
      costCategoryId: d.costCategoryId,
      phaseId: d.phaseId,
      milestoneId: d.milestoneId,
    };

    await prisma.cashTransaction.upsert({
      where: { sourceType_sourceId: { sourceType: d.sourceType, sourceId: d.sourceId } },
      create: { ...payload, sourceType: d.sourceType, sourceId: d.sourceId },
      update: payload,
    });

    if (existingKeys.has(key(d.sourceType, d.sourceId))) updated++;
    else created++;
  }

  // Sources that no longer produce a transaction — a task zeroed out, a tranche
  // un-received, a deleted row. Their ledger entries must go with them.
  const staleIds = existing
    .filter((e) => !wanted.has(key(e.sourceType, e.sourceId)))
    .map((e) => e.id);

  if (staleIds.length > 0) {
    await prisma.cashTransaction.deleteMany({ where: { id: { in: staleIds } } });
  }

  return { created, updated, deleted: staleIds.length };
}
