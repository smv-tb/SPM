export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toPence } from "@/lib/money";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { parseAmount } from "@/lib/accounting/input";
import { allocateSupplierPayment } from "@/lib/accounting/supplier-payments";
import { billAllocationSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Applies money paid on account to another open bill of the supplier. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = billAllocationSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    const allocation = await prisma.$transaction(async (tx) =>
      allocateSupplierPayment(
        tx,
        {
          paymentId: id,
          billId: data.billId,
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
