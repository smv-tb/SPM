export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { reconcileWithBills } from "@/lib/accounting/reconciliation";
import { reconcileBillsSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Money out that pays bills: records the supplier payment and reconciles it together. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const validation = reconcileBillsSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  try {
    const result = await prisma.$transaction((tx) =>
      reconcileWithBills(tx, { bankAccountId: id, ...validation.data }, guard.ctx.actor)
    );
    return NextResponse.json({ id: result.reconciliation.id, supplierPaymentId: result.supplierPaymentId }, { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
