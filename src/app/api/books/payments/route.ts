export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { parseAmount } from "@/lib/accounting/input";
import { paymentDetail, recordReceipt } from "@/lib/accounting/payments";
import { reconcileWithReceipt } from "@/lib/accounting/reconciliation";
import { serializePayment, serializePaymentRow } from "@/lib/accounting/serialize";
import { paymentSchema } from "@/schemas/books";

const PAGE_SIZE = 50;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const kind = params.get("kind");
  const contactId = params.get("contactId");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const where = {
    ...(kind === "RECEIPT" || kind === "REFUND" ? { kind: kind as "RECEIPT" | "REFUND" } : {}),
    ...(contactId ? { contactId } : {}),
  };

  const [total, payments] = await Promise.all([
    prisma.customerPayment.count({ where }),
    prisma.customerPayment.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { contact: { select: { id: true, name: true } }, allocations: { where: { releasedOn: null }, select: { amount: true } } },
    }),
  ]);

  return NextResponse.json({ payments: payments.map(serializePaymentRow), total, page, pageSize: PAGE_SIZE });
});

/**
 * Records money received — everyday bookkeeping, so `books:post`. It posts
 * as it is recorded: the bank has already moved the money.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = paymentSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  const allocations = data.allocations.map((a) => ({
    invoiceId: a.invoiceId,
    amount: a.amount === undefined || a.amount === "" ? undefined : parseAmount(a.amount),
  }));

  try {
    const payment = await prisma.$transaction(async (tx) => {
      if (data.statementLineId) {
        // The statement line fixes the date, amount and bank account.
        const { paymentId } = await reconcileWithReceipt(
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
        return tx.customerPayment.findUniqueOrThrow({ where: { id: paymentId }, include: paymentDetail });
      }
      return recordReceipt(
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
    return NextResponse.json(serializePayment(payment), { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
