export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { voidBill } from "@/lib/accounting/bills";
import { serializeBill } from "@/lib/accounting/serialize";
import { invoiceVoidSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Voiding reverses a posted journal — an Admin's call, always with a reason on record. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = invoiceVoidSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  try {
    const bill = await prisma.$transaction(async (tx) =>
      voidBill(tx, id, validation.data.reason, guard.ctx.actor)
    );
    return NextResponse.json(serializeBill(bill));
  } catch (error) {
    return booksError(error);
  }
});
