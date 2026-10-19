export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { loadAgedDebtors } from "@/lib/accounting/aged-debtors-query";

/** What each customer owed as at a date (default today), by how late it was. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  try {
    const asAt = toLedgerDate(
      req.nextUrl.searchParams.get("asAt") ?? calendarDateKey(new Date(), BUSINESS_TIME_ZONE)
    );
    return NextResponse.json(await loadAgedDebtors(prisma, asAt));
  } catch (error) {
    return booksError(error);
  }
});
