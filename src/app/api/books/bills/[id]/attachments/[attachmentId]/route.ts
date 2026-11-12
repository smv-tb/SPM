export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { removeBillAttachment } from "@/lib/accounting/bills";
import { attachmentDisposition } from "@/lib/accounting/bill-attachment";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

/**
 * The stored file, always as a download: the browser saves it rather than
 * opening it in our origin, and the sandbox CSP stops it running anything if
 * it is opened anyway. (next.config.mjs sets that CSP for this path too: its
 * headers replace a route's own.)
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id, attachmentId } = await params;
  const attachment = await prisma.billAttachment.findFirst({ where: { id: attachmentId, billId: id } });
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.size),
      "Content-Disposition": attachmentDisposition(attachment.fileName),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id, attachmentId } = await params;
  try {
    await prisma.$transaction(async (tx) => removeBillAttachment(tx, id, attachmentId, guard.ctx.actor));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
