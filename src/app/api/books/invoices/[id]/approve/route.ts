export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { approveInvoice } from "@/lib/accounting/invoices";
import { serializeInvoice } from "@/lib/accounting/serialize";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Approval allocates the invoice number and posts the sale, so it takes
 * `books:approve` (Admin) rather than everyday `books:post`.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const invoice = await prisma.$transaction(async (tx) => approveInvoice(tx, id, guard.ctx.actor));
    return NextResponse.json(serializeInvoice(invoice));
  } catch (error) {
    return booksError(error);
  }
});
