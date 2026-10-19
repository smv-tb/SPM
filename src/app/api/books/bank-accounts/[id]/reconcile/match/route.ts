export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { reconcile } from "@/lib/accounting/reconciliation";
import { reconcileMatchSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Matches statement lines to book entries already posted; the amounts must agree. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const validation = reconcileMatchSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  try {
    const rec = await prisma.$transaction((tx) =>
      reconcile(tx, { bankAccountId: id, ...validation.data }, guard.ctx.actor)
    );
    return NextResponse.json({ id: rec.id }, { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
