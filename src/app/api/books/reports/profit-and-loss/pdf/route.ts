export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { loadProfitAndLossReport } from "@/lib/accounting/profit-and-loss-load";
import { columnDate, renderReportPdf } from "@/lib/accounting/report-pdf";

/** The profit and loss as a PDF for the accountant. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;
  try {
    const params = req.nextUrl.searchParams;
    const [{ reports, rows, projectId, phaseId }, settings] = await Promise.all([
      loadProfitAndLossReport(prisma, params, params.get("includeZero") === "true"),
      prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } }),
    ]);
    const [main] = reports;
    const period = (r: { from: string; to: string }) => `${columnDate(r.from)} – ${columnDate(r.to)}`;
    const pdf = await renderReportPdf({
      title: "Profit and loss",
      company: {
        legalName: settings?.legalName ?? "",
        companyNumber: settings?.companyNumber ?? null,
        placeOfRegistration: settings?.placeOfRegistration ?? null,
      },
      subtitle: `${period(main)}${reports[1] ? `, compared with ${period(reports[1])}` : ""}`,
      columns: reports.map(period),
      rows,
      note:
        projectId || phaseId
          ? "Filtered to journal lines tagged with the selected project or phase; untagged lines are not included."
          : null,
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Profit-and-loss-${main.from}-to-${main.to}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return booksError(error);
  }
});
