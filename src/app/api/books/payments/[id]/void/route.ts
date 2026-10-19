export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { voidPayment } from "@/lib/accounting/payments";
import { serializePayment } from "@/lib/accounting/serialize";
import { invoiceVoidSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Voiding reverses the payment and re-opens what it paid, so it is an
 * Admin's call with a reason on record — like voiding any document.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = invoiceVoidSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  try {
    const payment = await prisma.$transaction(async (tx) =>
      voidPayment(tx, id, validation.data.reason, guard.ctx.actor)
    );
    return NextResponse.json(serializePayment(payment));
  } catch (error) {
    return booksError(error);
  }
});
