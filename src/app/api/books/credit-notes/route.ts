export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toInvoiceLines } from "@/lib/accounting/input";
import { approveCreditNote, createDraftCreditNote } from "@/lib/accounting/credit-notes";
import { CREDIT_NOTE_STATUSES, type CreditNoteStatus } from "@/lib/accounting/credit-note";
import { serializeCreditNote, serializeCreditNoteRow } from "@/lib/accounting/serialize";
import { creditNoteSchema } from "@/schemas/books";

const PAGE_SIZE = 50;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status");
  const status = CREDIT_NOTE_STATUSES.includes(statusParam as CreditNoteStatus)
    ? (statusParam as CreditNoteStatus)
    : null;
  const contactId = params.get("contactId");
  const invoiceId = params.get("invoiceId");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const where = {
    ...(status ? { status } : {}),
    ...(contactId ? { contactId } : {}),
    ...(invoiceId ? { invoiceId } : {}),
  };

  const [total, notes] = await Promise.all([
    prisma.creditNote.count({ where }),
    prisma.creditNote.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        invoice: { select: { id: true, number: true } },
        allocations: { where: { releasedOn: null }, select: { amount: true } },
      },
    }),
  ]);

  return NextResponse.json({
    creditNotes: notes.map(serializeCreditNoteRow),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = creditNoteSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  // Approval allocates the number and posts the credit: an Admin's call.
  if (data.approve && !(await requireBooks(req, "books:approve")).ok) {
    return NextResponse.json(
      { error: "Only an Admin can approve a credit note", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  try {
    const note = await prisma.$transaction(async (tx) => {
      const draft = await createDraftCreditNote(
        tx,
        {
          contactId: data.contactId,
          invoiceId: data.invoiceId ?? null,
          issueDate: toLedgerDate(data.issueDate),
          reference: data.reference,
          notes: data.notes,
          projectId: data.projectId,
          lines: toInvoiceLines(data.lines),
        },
        guard.ctx.actor
      );
      return data.approve ? approveCreditNote(tx, draft.id, guard.ctx.actor) : draft;
    });
    return NextResponse.json(serializeCreditNote(note), { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
