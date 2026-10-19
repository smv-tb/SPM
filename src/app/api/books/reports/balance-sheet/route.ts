export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { loadBalanceSheet } from "@/lib/accounting/balance-sheet-query";
import { balanceSheetRows } from "@/lib/accounting/balance-sheet";
import { reportDates } from "@/lib/accounting/report-request";

/** The balance sheet as at a date, with an optional comparative date. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;
  try {
    const params = req.nextUrl.searchParams;
    const { asAt, compare } = reportDates(params);
    const sheets = await Promise.all([asAt, ...(compare ? [compare] : [])].map((d) => loadBalanceSheet(prisma, d)));
    return NextResponse.json({
      sheets,
      rows: balanceSheetRows(sheets, { includeZero: params.get("includeZero") === "true" }),
    });
  } catch (error) {
    return booksError(error);
  }
});
