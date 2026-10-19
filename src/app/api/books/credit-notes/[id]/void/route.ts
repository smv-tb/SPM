export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { voidCreditNote } from "@/lib/accounting/credit-notes";
import { serializeCreditNote } from "@/lib/accounting/serialize";
import { invoiceVoidSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Voiding reverses the credit and makes the invoices it settled owing again,
 * so it is an Admin's call and always carries a reason.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = invoiceVoidSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  try {
    const note = await prisma.$transaction(async (tx) =>
      voidCreditNote(tx, id, validation.data.reason, guard.ctx.actor)
    );
    return NextResponse.json(serializeCreditNote(note));
  } catch (error) {
    return booksError(error);
  }
});
