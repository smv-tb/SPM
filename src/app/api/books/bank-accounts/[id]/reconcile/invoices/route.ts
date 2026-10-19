export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { reconcileWithInvoices } from "@/lib/accounting/reconciliation";
import { reconcileInvoicesSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Money in that pays invoices: records the payment and reconciles it together. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const validation = reconcileInvoicesSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  try {
    const result = await prisma.$transaction((tx) =>
      reconcileWithInvoices(tx, { bankAccountId: id, ...validation.data }, guard.ctx.actor)
    );
    return NextResponse.json({ id: result.reconciliation.id, paymentId: result.paymentId }, { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
