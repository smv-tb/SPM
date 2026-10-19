export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { requireBooks } from "@/lib/books-api";
import { paymentDetail } from "@/lib/accounting/payments";
import { serializePayment } from "@/lib/accounting/serialize";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const payment = await prisma.customerPayment.findUnique({ where: { id }, include: paymentDetail });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json(serializePayment(payment));
});
