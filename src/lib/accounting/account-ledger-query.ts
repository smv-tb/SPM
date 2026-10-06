import { Prisma } from "@prisma/client";
import { sumPence, toPence } from "@/lib/money";
import { buildAccountLedger, type AccountLedgerPage } from "./account-ledger";

type Reader = Pick<Prisma.TransactionClient, "journalLine">;

export interface AccountLedgerRow {
  lineId: string;
  entryId: string;
  number: number | null;
  date: Date;
  memo: string | null;
  reference: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

const ORDER: Prisma.JournalLineOrderByWithRelationInput[] = [
  { entry: { date: "asc" } },
  { entry: { number: "asc" } },
  { lineNumber: "asc" },
];

/**
 * One page of an account's posted lines with correct running balances, plus
 * the true opening and closing balance of the window. The totals are
 * aggregated in the database over the whole window; the balance carried into
 * a later page is summed from the (debit, credit) of the lines before it.
 */
export async function loadAccountLedger(
  db: Reader,
  args: { accountId: string; from: Date | null; to: Date | null; offset: number; limit: number }
): Promise<AccountLedgerPage<AccountLedgerRow>> {
  const { accountId, from, to, offset, limit } = args;
  const inWindow: Prisma.JournalLineWhereInput = {
    accountId,
    entry: {
      status: "POSTED",
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
  };

  const [opening, window, before, lines] = await Promise.all([
    from
      ? db.journalLine.aggregate({
          where: { accountId, entry: { status: "POSTED", date: { lt: from } } },
          _sum: { debit: true, credit: true },
        })
      : null,
    db.journalLine.aggregate({
      where: inWindow,
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    }),
    offset > 0
      ? db.journalLine.findMany({
          where: inWindow,
          select: { debit: true, credit: true },
          orderBy: ORDER,
          take: offset,
        })
      : [],
    db.journalLine.findMany({
      where: inWindow,
      include: { entry: { select: { id: true, number: true, date: true, memo: true, reference: true } } },
      orderBy: ORDER,
      skip: offset,
      take: limit,
    }),
  ]);

  return buildAccountLedger({
    openingBalance: opening
      ? sumPence([toPence(opening._sum.debit ?? 0), -toPence(opening._sum.credit ?? 0)])
      : 0,
    windowDebit: toPence(window._sum.debit ?? 0),
    windowCredit: toPence(window._sum.credit ?? 0),
    total: window._count._all,
    carriedIn: sumPence(before.flatMap((l) => [toPence(l.debit), -toPence(l.credit)])),
    offset,
    limit,
    lines: lines.map((line) => ({
      lineId: line.id,
      entryId: line.entry.id,
      number: line.entry.number,
      date: line.entry.date,
      memo: line.entry.memo,
      reference: line.entry.reference,
      description: line.description,
      debit: toPence(line.debit),
      credit: toPence(line.credit),
    })),
  });
}
