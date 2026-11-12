export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { AccountingError } from "@/lib/accounting/errors";
import { addBillAttachment } from "@/lib/accounting/bills";
import { MAX_ATTACHMENT_BYTES } from "@/lib/accounting/bill-attachment";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Attaches the supplier's document (multipart field `file`). Held in memory,
 * checked by its own bytes, and stored with the bill — never written to disk
 * or opened.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AccountingError("BAD_UPLOAD", "Send the document as a file upload", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AccountingError("BAD_UPLOAD", "Choose a file to attach", 400);
    // Refuse before reading the bytes into memory.
    if (file.size > MAX_ATTACHMENT_BYTES) throw new AccountingError("BAD_FILE", "The file is larger than 5 MB", 422);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachment = await prisma.$transaction(async (tx) =>
      addBillAttachment(tx, id, { fileName: file.name, bytes }, guard.ctx.actor)
    );
    return NextResponse.json(
      {
        id: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        createdAt: attachment.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    return booksError(error);
  }
});
