export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { loadProfitAndLossReport } from "@/lib/accounting/profit-and-loss-load";

/** Profit and loss for a period, with an optional comparative period and project / phase filter. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;
  try {
    const params = req.nextUrl.searchParams;
    const { reports, rows } = await loadProfitAndLossReport(prisma, params, params.get("includeZero") === "true");
    return NextResponse.json({ reports, rows });
  } catch (error) {
    return booksError(error);
  }
});
