export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { voidInvoice } from "@/lib/accounting/invoices";
import { serializeInvoice } from "@/lib/accounting/serialize";
import { invoiceVoidSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Voiding cancels a document that has a number and, once approved, a posted
 * journal to reverse — an Admin's call, and always with a reason on record.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = invoiceVoidSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  try {
    const invoice = await prisma.$transaction(async (tx) =>
      voidInvoice(tx, id, validation.data.reason, guard.ctx.actor)
    );
    return NextResponse.json(serializeInvoice(invoice));
  } catch (error) {
    return booksError(error);
  }
});
