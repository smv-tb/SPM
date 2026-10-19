export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { postJournal } from "@/lib/accounting/posting";
import { serializeEntry } from "@/lib/accounting/serialize";

type RouteContext = { params: Promise<{ id: string }> };

/** Posts a draft: allocates its number and freezes it. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const posted = await prisma.$transaction((tx) => postJournal(tx, id, guard.ctx.actor));
    const full = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: posted.id },
      include: {
        lines: { orderBy: { lineNumber: "asc" }, include: { account: { select: { code: true, name: true } } } },
      },
    });
    return NextResponse.json(serializeEntry(full));
  } catch (error) {
    return booksError(error);
  }
});
