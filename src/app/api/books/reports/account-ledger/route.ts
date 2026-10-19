export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { toPence } from "@/lib/money";
import { MAX_PAGE_LIMIT } from "@/lib/constants";
import { booksError, requireBooks } from "@/lib/books-api";
import { ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { NORMAL_BALANCE } from "@/lib/accounting/chart";

/**
 * Every posted movement on one account, with an opening balance and a running
 * balance — the report an accountant opens to ask "why is this account this
 * number?".
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const accountId = params.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const account = await prisma.ledgerAccount.findUnique({ where: { id: accountId } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const from = params.get("from") ? toLedgerDate(params.get("from")!) : null;
    const to = params.get("to") ? toLedgerDate(params.get("to")!) : null;
    const take = Math.min(Number(params.get("limit")) || MAX_PAGE_LIMIT, 1000);

    // Everything posted before the window is the opening balance.
    const opening = from
      ? await prisma.journalLine.aggregate({
          where: { accountId, entry: { status: "POSTED", date: { lt: from } } },
          _sum: { debit: true, credit: true },
        })
      : null;

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId,
        entry: {
          status: "POSTED",
          ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
      },
      include: { entry: { select: { id: true, number: true, date: true, memo: true, reference: true } } },
      orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }, { lineNumber: "asc" }],
      take,
    });

    const openingBalance = opening
      ? toPence(opening._sum.debit ?? 0) - toPence(opening._sum.credit ?? 0)
      : 0;

    let running = openingBalance;
    const rows = lines.map((line) => {
      const debit = toPence(line.debit);
      const credit = toPence(line.credit);
      running += debit - credit;
      return {
        lineId: line.id,
        entryId: line.entry.id,
        number: line.entry.number,
        date: ledgerDateKey(line.entry.date),
        memo: line.entry.memo,
        reference: line.entry.reference,
        description: line.description,
        debit,
        credit,
        balance: running,
      };
    });

    return NextResponse.json({
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: NORMAL_BALANCE[account.type],
      },
      from: from ? ledgerDateKey(from) : null,
      to: to ? ledgerDateKey(to) : null,
      openingBalance,
      closingBalance: running,
      rows,
      truncated: rows.length === take,
    });
  } catch (error) {
    return booksError(error);
  }
});
