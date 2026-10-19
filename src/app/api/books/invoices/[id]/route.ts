export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toInvoiceLines } from "@/lib/accounting/input";
import { deleteDraftInvoice, updateDraftInvoice } from "@/lib/accounting/invoices";
import { serializeInvoice } from "@/lib/accounting/serialize";
import { invoiceSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

const withDetail = {
  lines: { orderBy: { lineNumber: "asc" } },
  journalEntry: { select: { id: true, number: true } },
  contact: { select: { id: true, name: true } },
  creditAllocations: {
    where: { releasedOn: null },
    orderBy: { createdAt: "asc" },
    include: { creditNote: { select: { id: true, number: true } } },
  },
  paymentAllocations: {
    where: { releasedOn: null },
    orderBy: { createdAt: "asc" },
    include: { payment: { select: { id: true, date: true, reference: true } } },
  },
} as const;

export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: withDetail });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json(serializeInvoice(invoice));
});

/** Drafts only: an approved invoice is corrected by a credit note, not an edit. */
export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = invoiceSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    const invoice = await prisma.$transaction(async (tx) =>
      updateDraftInvoice(
        tx,
        id,
        {
          contactId: data.contactId,
          issueDate: toLedgerDate(data.issueDate),
          paymentTermsDays: data.paymentTermsDays,
          reference: data.reference,
          notes: data.notes,
          projectId: data.projectId,
          lines: toInvoiceLines(data.lines),
        },
        guard.ctx.actor
      )
    );
    return NextResponse.json(serializeInvoice(invoice));
  } catch (error) {
    return booksError(error);
  }
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => deleteDraftInvoice(tx, id, guard.ctx.actor));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
