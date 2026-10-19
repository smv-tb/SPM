export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { autoReconcile } from "@/lib/accounting/reconciliation";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Applies every match safe without a person, recording payments for invoices
 * the bank shows paid. All or nothing: one transaction.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const result = await prisma.$transaction((tx) => autoReconcile(tx, id, guard.ctx.actor), {
      maxWait: 10_000,
      timeout: 60_000,
    });
    return NextResponse.json(result);
  } catch (error) {
    return booksError(error);
  }
});
