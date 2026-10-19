export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { markInvoiceSent } from "@/lib/accounting/invoices";
import { serializeInvoice } from "@/lib/accounting/serialize";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { invoiceSendSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Records that the invoice went out. Sending it is still done by hand. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const validation = invoiceSendSchema.safeParse(body);
  if (!validation.success) return invalidRequest(validation.error.flatten());

  const sentAt = toLedgerDate(
    validation.data.sentAt ?? calendarDateKey(new Date(), BUSINESS_TIME_ZONE)
  );

  try {
    const invoice = await prisma.$transaction(async (tx) =>
      markInvoiceSent(tx, id, sentAt, guard.ctx.actor)
    );
    return NextResponse.json(serializeInvoice(invoice));
  } catch (error) {
    return booksError(error);
  }
});
