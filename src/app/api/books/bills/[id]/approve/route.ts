export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { approveBill } from "@/lib/accounting/bills";
import { serializeBill } from "@/lib/accounting/serialize";

type RouteContext = { params: Promise<{ id: string }> };

/** Approval posts the purchase to the ledger, so it takes `books:approve` (Admin). */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:approve");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const bill = await prisma.$transaction(async (tx) => approveBill(tx, id, guard.ctx.actor));
    return NextResponse.json(serializeBill(bill));
  } catch (error) {
    return booksError(error);
  }
});
