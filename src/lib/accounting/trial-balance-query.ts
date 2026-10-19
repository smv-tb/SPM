import { Prisma } from "@prisma/client";
import { toPence } from "@/lib/money";
import { buildTrialBalance, type TrialBalance } from "./trial-balance";

type Reader = Pick<Prisma.TransactionClient, "ledgerAccount" | "journalLine">;

/** Posted journals only, up to `asAt` (and from `from` for a period view). */
export async function loadTrialBalance(
  db: Reader,
  asAt: Date,
  options: { from?: Date | null; includeZero?: boolean } = {}
): Promise<TrialBalance> {
  const [accounts, movements] = await Promise.all([
    db.ledgerAccount.findMany({ select: { id: true, code: true, name: true, type: true } }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "POSTED", date: { lte: asAt, ...(options.from ? { gte: options.from } : {}) } } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  return buildTrialBalance(
    accounts,
    movements.map((m) => ({
      accountId: m.accountId,
      debit: toPence(m._sum.debit ?? 0),
      credit: toPence(m._sum.credit ?? 0),
    })),
    { includeZero: options.includeZero }
  );
}
