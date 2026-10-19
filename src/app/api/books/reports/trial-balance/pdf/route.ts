export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { formatPence } from "@/lib/money";
import { ledgerDateKey } from "@/lib/accounting/dates";
import { reportDates } from "@/lib/accounting/report-request";
import { loadTrialBalance } from "@/lib/accounting/trial-balance-query";
import { TRIAL_BALANCE_COLUMNS, trialBalanceRows } from "@/lib/accounting/report-rows";
import { columnDate, renderReportPdf } from "@/lib/accounting/report-pdf";

/** The trial balance as a PDF, as at a date. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;
  try {
    const { asAt } = reportDates(req.nextUrl.searchParams);
    const [tb, settings] = await Promise.all([
      loadTrialBalance(prisma, asAt, { includeZero: req.nextUrl.searchParams.get("includeZero") === "true" }),
      prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } }),
    ]);
    const key = ledgerDateKey(asAt);
    const pdf = await renderReportPdf({
      title: "Trial balance",
      company: {
        legalName: settings?.legalName ?? "",
        companyNumber: settings?.companyNumber ?? null,
        placeOfRegistration: settings?.placeOfRegistration ?? null,
      },
      subtitle: `As at ${columnDate(key)}`,
      columns: TRIAL_BALANCE_COLUMNS,
      rows: trialBalanceRows(tb),
      note: tb.balanced ? null : `Out of balance by ${formatPence(tb.totalDebit - tb.totalCredit)}: investigate before relying on this.`,
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Trial-balance-${key}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return booksError(error);
  }
});
