export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { undoStatementImport } from "@/lib/accounting/statements";

type RouteContext = { params: Promise<{ id: string }> };

/** Rolls back an unreconciled import; the record of it stays. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const undone = await prisma.$transaction((tx) => undoStatementImport(tx, id, guard.ctx.actor));
    return NextResponse.json({ id: undone.id, status: undone.status });
  } catch (error) {
    return booksError(error);
  }
});
