export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toPence } from "@/lib/money";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { parseAmount } from "@/lib/accounting/input";
import { allocatePayment } from "@/lib/accounting/payments";
import { creditAllocationSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Applies unallocated money from a receipt to another open invoice of the customer. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = creditAllocationSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    const allocation = await prisma.$transaction(async (tx) =>
      allocatePayment(
        tx,
        {
          paymentId: id,
          invoiceId: data.invoiceId,
          amount: data.amount === undefined || data.amount === "" ? undefined : parseAmount(data.amount),
          date: toLedgerDate(data.date ?? calendarDateKey(new Date(), BUSINESS_TIME_ZONE)),
        },
        guard.ctx.actor
      )
    );
    return NextResponse.json({ id: allocation.id, amount: toPence(allocation.amount) }, { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
