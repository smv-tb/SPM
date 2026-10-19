export const dynamic = "force-dynamic";
// pdf-lib needs the Node runtime, not the Edge one.
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { requireBooks } from "@/lib/books-api";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { serializeInvoice } from "@/lib/accounting/serialize";
import { invoicePdfFilename, pdfCompany, renderInvoicePdf } from "@/lib/accounting/invoice-pdf";
import { settlementInclude } from "@/lib/accounting/settlement";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      // Allocations, so a credited invoice prints what is still due.
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        ...settlementInclude,
      },
    }),
    prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } }),
  ]);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const serialized = serializeInvoice(invoice);
  const pdf = await renderInvoicePdf(
    { ...serialized, lines: serialized.lines ?? [] },
    pdfCompany(settings)
  );

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline` so it opens in the viewer; the browser's save button keeps
      // this filename, which is what gets attached to an email.
      "Content-Disposition": `inline; filename="${invoicePdfFilename(invoice)}"`,
      "Cache-Control": "no-store",
    },
  });
});
