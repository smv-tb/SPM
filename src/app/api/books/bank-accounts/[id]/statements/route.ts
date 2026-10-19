export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { importStatement } from "@/lib/accounting/statements";
import { readStatementUpload } from "@/lib/statement-upload";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Imports a statement file: the same reading as the preview, then the new
 * lines written as one import. Lines already held are skipped and counted.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const upload = await readStatementUpload(req);
    const { batch } = await prisma.$transaction(
      (tx) => importStatement(tx, id, upload, guard.ctx.actor),
      // A 20,000-line file is written in one go; give it room.
      { maxWait: 10_000, timeout: 60_000 }
    );
    return NextResponse.json(
      { id: batch.id, lineCount: batch.lineCount, duplicateCount: batch.duplicateCount },
      { status: 201 }
    );
  } catch (error) {
    return booksError(error);
  }
});
