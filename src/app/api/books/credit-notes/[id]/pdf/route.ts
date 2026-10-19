export const dynamic = "force-dynamic";
// pdf-lib needs the Node runtime, not the Edge one.
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { requireBooks } from "@/lib/books-api";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { serializeCreditNote } from "@/lib/accounting/serialize";
import {
  creditNotePdfFilename,
  pdfCompany,
  renderInvoicePdf,
} from "@/lib/accounting/invoice-pdf";

type RouteContext = { params: Promise<{ id: string }> };

/** The credit note on the invoice's layout, titled CREDIT NOTE. */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const [note, settings] = await Promise.all([
    prisma.creditNote.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        invoice: { select: { id: true, number: true } },
      },
    }),
    prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } }),
  ]);
  if (!note) return NextResponse.json({ error: "Credit note not found" }, { status: 404 });

  const serialized = serializeCreditNote(note);
  const pdf = await renderInvoicePdf(
    {
      ...serialized,
      kind: "credit_note",
      creditFor: serialized.invoiceNumber,
      // A credit note has no terms; these fields only print on invoices.
      dueDate: serialized.issueDate,
      paymentTermsDays: 0,
      sentAt: null,
      lines: serialized.lines ?? [],
    },
    pdfCompany(settings)
  );

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${creditNotePdfFilename(note)}"`,
      "Cache-Control": "no-store",
    },
  });
});
