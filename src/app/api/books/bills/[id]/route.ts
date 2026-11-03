export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toBillLines } from "@/lib/accounting/input";
import { asBillError, attachmentMeta, deleteDraftBill, updateDraftBill } from "@/lib/accounting/bills";
import { serializeBill } from "@/lib/accounting/serialize";
import { billSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

const withDetail = {
  lines: { orderBy: { lineNumber: "asc" }, include: { account: { select: { code: true, name: true } } } },
  attachments: { select: attachmentMeta, orderBy: { createdAt: "asc" } },
  journalEntry: { select: { id: true, number: true } },
} as const;

export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const bill = await prisma.bill.findUnique({ where: { id }, include: withDetail });
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  return NextResponse.json(serializeBill(bill));
});

/** Drafts only: an approved bill is corrected by voiding it. */
export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = billSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    const bill = await prisma.$transaction(async (tx) =>
      updateDraftBill(
        tx,
        id,
        {
          contactId: data.contactId,
          supplierReference: data.supplierReference,
          issueDate: toLedgerDate(data.issueDate),
          dueDate: data.dueDate ? toLedgerDate(data.dueDate) : null,
          notes: data.notes,
          projectId: data.projectId,
          lines: toBillLines(data.lines),
        },
        guard.ctx.actor
      )
    );
    return NextResponse.json(serializeBill(bill));
  } catch (error) {
    return booksError(asBillError(error));
  }
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => deleteDraftBill(tx, id, guard.ctx.actor));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
