import { Prisma } from "@prisma/client";
import { toPence } from "@/lib/money";
import { ledgerDateKey } from "./dates";
import { buildProfitAndLoss, type ProfitAndLoss } from "./profit-and-loss";

type Reader = Pick<Prisma.TransactionClient, "ledgerAccount" | "journalLine">;

export interface DimensionFilter {
  projectId?: string | null;
  phaseId?: string | null;
}

/**
 * The profit and loss for a period (both days inclusive), from posted
 * journals only. The optional project / phase filter narrows it to the lines
 * tagged with that tracking dimension.
 */
export async function loadProfitAndLoss(db: Reader, from: Date, to: Date, dimension: DimensionFilter = {}): Promise<ProfitAndLoss> {
  const [accounts, movements] = await Promise.all([
    db.ledgerAccount.findMany({
      where: { type: { in: ["INCOME", "EXPENSE"] } },
      select: { id: true, code: true, name: true, type: true },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: {
        entry: { status: "POSTED", date: { gte: from, lte: to } },
        ...(dimension.projectId ? { projectId: dimension.projectId } : {}),
        ...(dimension.phaseId ? { phaseId: dimension.phaseId } : {}),
      },
      _sum: { debit: true, credit: true },
    }),
  ]);
  return buildProfitAndLoss({
    from: ledgerDateKey(from),
    to: ledgerDateKey(to),
    accounts,
    movements: movements.map((m) => ({
      accountId: m.accountId,
      debit: toPence(m._sum.debit ?? 0),
      credit: toPence(m._sum.credit ?? 0),
    })),
  });
}
