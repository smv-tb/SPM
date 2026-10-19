export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { reconcileView } from "@/lib/accounting/reconciliation";

type RouteContext = { params: Promise<{ id: string }> };

/** Unreconciled statement lines with suggested matches, and book entries not on the statement. */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    return NextResponse.json(await reconcileView(prisma, id));
  } catch (error) {
    return booksError(error);
  }
});
