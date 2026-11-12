export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { voidSupplierPayment } from "@/lib/accounting/supplier-payments";
import { serializeSupplierPayment } from "@/lib/accounting/serialize";
import { invoiceVoidSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Voiding reverses the payment and re-opens the bills it paid, so it is an
 * Admin's call with a reason on record — like voiding a customer payment.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = invoiceVoidSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  try {
    const payment = await prisma.$transaction(async (tx) =>
      voidSupplierPayment(tx, id, validation.data.reason, guard.ctx.actor)
    );
    return NextResponse.json(serializeSupplierPayment(payment));
  } catch (error) {
    return booksError(error);
  }
});
