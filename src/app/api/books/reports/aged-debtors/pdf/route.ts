export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { ledgerDateKey } from "@/lib/accounting/dates";
import { reportDates } from "@/lib/accounting/report-request";
import { loadAgedDebtors } from "@/lib/accounting/aged-debtors-query";
import { AGED_DEBTORS_COLUMNS, agedDebtorsRows } from "@/lib/accounting/report-rows";
import { columnDate, renderReportPdf } from "@/lib/accounting/report-pdf";

/** Aged debtors as a PDF, as at a date. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;
  try {
    const { asAt } = reportDates(req.nextUrl.searchParams);
    const [report, settings] = await Promise.all([
      loadAgedDebtors(prisma, asAt),
      prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } }),
    ]);
    const key = ledgerDateKey(asAt);
    const pdf = await renderReportPdf({
      title: "Aged debtors",
      company: {
        legalName: settings?.legalName ?? "",
        companyNumber: settings?.companyNumber ?? null,
        placeOfRegistration: settings?.placeOfRegistration ?? null,
      },
      subtitle: `What customers owed on ${columnDate(key)}, by how late it is`,
      columns: AGED_DEBTORS_COLUMNS,
      rows: agedDebtorsRows(report),
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Aged-debtors-${key}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return booksError(error);
  }
});
