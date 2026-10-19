export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { previewStatement } from "@/lib/accounting/statements";
import { readStatementUpload } from "@/lib/statement-upload";

type RouteContext = { params: Promise<{ id: string }> };

/** Reads a statement file and reports what importing it would do. Writes nothing. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const upload = await readStatementUpload(req);
    // Fingerprints are an implementation detail of the import, not the page's business.
    const { fingerprints: _fingerprints, ...preview } = await previewStatement(
      prisma,
      id,
      upload.bytes,
      upload.profile
    );
    void _fingerprints;
    return NextResponse.json({ fileName: upload.fileName, ...preview });
  } catch (error) {
    return booksError(error);
  }
});
