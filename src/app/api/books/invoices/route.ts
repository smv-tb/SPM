export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toInvoiceLines } from "@/lib/accounting/input";
import { approveInvoice, createDraftInvoice } from "@/lib/accounting/invoices";
import { serializeInvoice, serializeInvoiceRow } from "@/lib/accounting/serialize";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/accounting/invoice";
import { invoiceSchema } from "@/schemas/books";
import { settlementInclude } from "@/lib/accounting/settlement";

const PAGE_SIZE = 50;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status");
  const status = INVOICE_STATUSES.includes(statusParam as InvoiceStatus)
    ? (statusParam as InvoiceStatus)
    : null;
  const contactId = params.get("contactId");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const where = {
    ...(status ? { status } : {}),
    ...(contactId ? { contactId } : {}),
  };

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: settlementInclude,
    }),
  ]);

  return NextResponse.json({
    invoices: invoices.map(serializeInvoiceRow),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = invoiceSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  // Allocating a number is the approval step, and that is an Admin's call.
  if (data.approve && !(await requireBooks(req, "books:approve")).ok) {
    return NextResponse.json(
      { error: "Only an Admin can approve an invoice", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const draft = await createDraftInvoice(
        tx,
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
      );
      return data.approve ? approveInvoice(tx, draft.id, guard.ctx.actor) : draft;
    });
    return NextResponse.json(serializeInvoice(invoice), { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
