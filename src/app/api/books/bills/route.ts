export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toBillLines } from "@/lib/accounting/input";
import { approveBill, asBillError, createDraftBill } from "@/lib/accounting/bills";
import { serializeBill, serializeBillRow } from "@/lib/accounting/serialize";
import { billSettlementInclude } from "@/lib/accounting/supplier-payments";
import { BILL_STATUSES, type BillStatus } from "@/lib/accounting/bill";
import { billSchema } from "@/schemas/books";

const PAGE_SIZE = 50;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status");
  const status = BILL_STATUSES.includes(statusParam as BillStatus) ? (statusParam as BillStatus) : null;
  const contactId = params.get("contactId");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const where = {
    ...(status ? { status } : {}),
    ...(contactId ? { contactId } : {}),
  };

  const [total, bills] = await Promise.all([
    prisma.bill.count({ where }),
    prisma.bill.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { attachments: true } }, ...billSettlementInclude },
    }),
  ]);

  return NextResponse.json({ bills: bills.map(serializeBillRow), total, page, pageSize: PAGE_SIZE });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = billSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  // Approval posts to the ledger, and that is an Admin's call.
  if (data.approve && !(await requireBooks(req, "books:approve")).ok) {
    return NextResponse.json({ error: "Only an Admin can approve a bill", code: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const bill = await prisma.$transaction(async (tx) => {
      const draft = await createDraftBill(
        tx,
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
      );
      return data.approve ? approveBill(tx, draft.id, guard.ctx.actor) : draft;
    });
    return NextResponse.json(serializeBill(bill), { status: 201 });
  } catch (error) {
    return booksError(asBillError(error));
  }
});
