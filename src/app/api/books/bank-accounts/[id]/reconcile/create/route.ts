export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { createAndReconcile } from "@/lib/accounting/reconciliation";
import { reconcileCreateSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Posts a statement line with nothing in the books to an account, and reconciles it. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const validation = reconcileCreateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  try {
    const result = await prisma.$transaction((tx) =>
      createAndReconcile(tx, { bankAccountId: id, ...validation.data }, guard.ctx.actor)
    );
    return NextResponse.json(
      { id: result.reconciliation.id, journalEntryId: result.journalEntryId },
      { status: 201 }
    );
  } catch (error) {
    return booksError(error);
  }
});
