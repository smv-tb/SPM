export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toInvoiceLines } from "@/lib/accounting/input";
import {
  creditNoteDetail,
  deleteDraftCreditNote,
  updateDraftCreditNote,
} from "@/lib/accounting/credit-notes";
import { serializeCreditNote } from "@/lib/accounting/serialize";
import { creditNoteSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const note = await prisma.creditNote.findUnique({ where: { id }, include: creditNoteDetail });
  if (!note) return NextResponse.json({ error: "Credit note not found" }, { status: 404 });
  return NextResponse.json(serializeCreditNote(note));
});

/** Drafts only: an approved credit note is voided, never edited. */
export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = creditNoteSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    const note = await prisma.$transaction(async (tx) =>
      updateDraftCreditNote(
        tx,
        id,
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
      )
    );
    return NextResponse.json(serializeCreditNote(note));
  } catch (error) {
    return booksError(error);
  }
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => deleteDraftCreditNote(tx, id, guard.ctx.actor));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
