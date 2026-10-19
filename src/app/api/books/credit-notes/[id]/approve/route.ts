export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { approveCreditNote } from "@/lib/accounting/credit-notes";
import { serializeCreditNote } from "@/lib/accounting/serialize";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Approval allocates the CN number, posts the credit and applies it to the
 * invoice it corrects — `books:approve` (Admin), as for invoices.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const note = await prisma.$transaction(async (tx) => approveCreditNote(tx, id, guard.ctx.actor));
    return NextResponse.json(serializeCreditNote(note));
  } catch (error) {
    return booksError(error);
  }
});
