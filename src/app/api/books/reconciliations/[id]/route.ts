export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { unreconcile } from "@/lib/accounting/reconciliation";

type RouteContext = { params: Promise<{ id: string }> };

/** Unmatches: the link goes, anything matching created stays in the books. */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    await prisma.$transaction((tx) => unreconcile(tx, id, guard.ctx.actor));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
