export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { parseAmount } from "@/lib/accounting/input";
import { recordRefund } from "@/lib/accounting/payments";
import { serializePayment } from "@/lib/accounting/serialize";
import { refundSchema } from "@/schemas/books";

/**
 * Pays unused credit back to a customer. Money leaving the business is an
 * Admin's call (`books:approve`), unlike recording money coming in.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const validation = refundSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    const refund = await prisma.$transaction(async (tx) =>
      recordRefund(
        tx,
        {
          source: data.source,
          date: toLedgerDate(data.date),
          amount: data.amount === undefined || data.amount === "" ? undefined : parseAmount(data.amount),
          bankAccountId: data.bankAccountId,
          reference: data.reference,
          notes: data.notes,
        },
        guard.ctx.actor
      )
    );
    return NextResponse.json(serializePayment(refund), { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
