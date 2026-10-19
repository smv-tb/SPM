export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { formatPence } from "@/lib/money";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { loadBalanceSheet } from "@/lib/accounting/balance-sheet-query";
import { balanceSheetRows } from "@/lib/accounting/balance-sheet";
import { reportDates } from "@/lib/accounting/report-request";
import { columnDate, renderReportPdf } from "@/lib/accounting/report-pdf";

/** The balance sheet as a PDF for the accountant, as at a date (and a comparative). */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;
  try {
    const params = req.nextUrl.searchParams;
    const { asAt, compare } = reportDates(params);
    const [sheets, settings] = await Promise.all([
      Promise.all([asAt, ...(compare ? [compare] : [])].map((d) => loadBalanceSheet(prisma, d))),
      prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } }),
    ]);
    const [main] = sheets;
    const pdf = await renderReportPdf({
      title: "Balance sheet",
      company: {
        legalName: settings?.legalName ?? "",
        companyNumber: settings?.companyNumber ?? null,
        placeOfRegistration: settings?.placeOfRegistration ?? null,
      },
      subtitle: `As at ${columnDate(main.asAt)}${compare ? `, compared with ${columnDate(sheets[1].asAt)}` : ""}`,
      columns: sheets.map((s) => columnDate(s.asAt)),
      rows: balanceSheetRows(sheets, { includeZero: params.get("includeZero") === "true" }),
      note: sheets.every((s) => s.balanced)
        ? `Assets equal liabilities plus equity. The financial year began on ${columnDate(main.yearStart)}; profit from earlier years is shown as brought forward until year-end close moves it into retained earnings.`
        : `Out of balance by ${formatPence(main.totalAssets - main.totalLiabilitiesAndEquity)}: investigate before relying on this.`,
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Balance-sheet-${main.asAt}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return booksError(error);
  }
});
