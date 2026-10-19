export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { calendarDateKey, ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { loadTrialBalance } from "@/lib/accounting/trial-balance-query";

/**
 * Trial balance as at a date (default today), optionally from a start date for
 * a period view. Posted journals only — drafts are not part of the books.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  try {
    const asAt = toLedgerDate(params.get("asAt") ?? calendarDateKey(new Date(), BUSINESS_TIME_ZONE));
    const from = params.get("from") ? toLedgerDate(params.get("from")!) : null;
    const includeZero = params.get("includeZero") === "true";

    const trialBalance = await loadTrialBalance(prisma, asAt, { from, includeZero });

    return NextResponse.json({
      asAt: ledgerDateKey(asAt),
      from: from ? ledgerDateKey(from) : null,
      ...trialBalance,
    });
  } catch (error) {
    return booksError(error);
  }
});
