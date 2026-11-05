export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { requireBooks } from "@/lib/books-api";
import { ledgerDateKey } from "@/lib/accounting/dates";
import { toPence } from "@/lib/money";

/**
 * Money-out statement lines not yet reconciled: what "Record payment" on a bill
 * offers to tag the payment to. Read-only, so `books:view`; recording takes `books:post`.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const lines = await prisma.statementLine.findMany({
    where: { reconciledAt: null, amount: { lt: 0 }, bankAccount: { isArchived: false } },
    orderBy: [{ date: "desc" }, { sequence: "desc" }],
    take: 200,
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      bankAccount: { select: { id: true, name: true, ledgerAccountId: true } },
    },
  });

  return NextResponse.json({
    lines: lines.map((l) => ({
      id: l.id,
      date: ledgerDateKey(l.date),
      // What was paid, as a positive amount.
      amount: -toPence(l.amount),
      description: l.description,
      bankAccountName: l.bankAccount.name,
      ledgerAccountId: l.bankAccount.ledgerAccountId,
    })),
  });
});
