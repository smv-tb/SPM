export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { MAX_PAGE_LIMIT } from "@/lib/constants";
import { booksError, requireBooks } from "@/lib/books-api";
import { ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { NORMAL_BALANCE } from "@/lib/accounting/chart";
import { loadAccountLedger } from "@/lib/accounting/account-ledger-query";

/**
 * Every posted movement on one account, with an opening balance and a running
 * balance — the report an accountant opens to ask "why is this account this
 * number?".
 *
 * Rows are paged (`limit`, `offset`) but `openingBalance` and `closingBalance`
 * always describe the whole window; `pageOpeningBalance` is where the first
 * row of the page starts, so each row's `balance` is right for its position.
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
    const limit = Math.min(Math.max(Math.floor(Number(params.get("limit"))) || MAX_PAGE_LIMIT, 1), 1000);
    const offset = Math.max(Math.floor(Number(params.get("offset"))) || 0, 0);

    const page = await loadAccountLedger(prisma, { accountId, from, to, offset, limit });

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
      openingBalance: page.openingBalance,
      closingBalance: page.closingBalance,
      pageOpeningBalance: page.pageOpeningBalance,
      rows: page.rows.map((r) => ({ ...r, date: ledgerDateKey(r.date) })),
      offset: page.offset,
      limit: page.limit,
      total: page.total,
      truncated: page.truncated,
      nextOffset: page.nextOffset,
    });
  } catch (error) {
    return booksError(error);
  }
});
