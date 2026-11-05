export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { parseAmount } from "@/lib/accounting/input";
import { recordSupplierPayment, supplierPaymentDetail } from "@/lib/accounting/supplier-payments";
import { reconcileWithSupplierPayment } from "@/lib/accounting/reconciliation";
import { serializeSupplierPayment, serializeSupplierPaymentRow } from "@/lib/accounting/serialize";
import { supplierPaymentSchema } from "@/schemas/books";

const PAGE_SIZE = 50;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const contactId = params.get("contactId");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const where = contactId ? { contactId } : {};

  const [total, payments] = await Promise.all([
    prisma.supplierPayment.count({ where }),
    prisma.supplierPayment.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { contact: { select: { id: true, name: true } }, allocations: { where: { releasedOn: null }, select: { amount: true } } },
    }),
  ]);

  return NextResponse.json({ payments: payments.map(serializeSupplierPaymentRow), total, page, pageSize: PAGE_SIZE });
});

/**
 * Records money paid to a supplier — everyday bookkeeping, so `books:post`,
 * like a customer receipt. It posts as it is recorded: the bank has already
 * sent the money.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = supplierPaymentSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  const allocations = data.allocations.map((a) => ({
    billId: a.billId,
    amount: a.amount === undefined || a.amount === "" ? undefined : parseAmount(a.amount),
  }));

  try {
    const payment = await prisma.$transaction(async (tx) => {
      if (data.statementLineId) {
        // The statement line fixes the date, amount and bank account.
        const { supplierPaymentId } = await reconcileWithSupplierPayment(
          tx,
          {
            statementLineId: data.statementLineId,
            contactId: data.contactId,
            allocations,
            reference: data.reference,
            notes: data.notes,
            method: "MANUAL",
          },
          guard.ctx.actor
        );
        return tx.supplierPayment.findUniqueOrThrow({ where: { id: supplierPaymentId }, include: supplierPaymentDetail });
      }
      return recordSupplierPayment(
        tx,
        {
          contactId: data.contactId,
          date: toLedgerDate(data.date),
          amount: parseAmount(data.amount),
          bankAccountId: data.bankAccountId,
          reference: data.reference,
          notes: data.notes,
          allocations,
        },
        guard.ctx.actor
      );
    });
    return NextResponse.json(serializeSupplierPayment(payment), { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
