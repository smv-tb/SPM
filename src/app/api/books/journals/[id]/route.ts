export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toLineDrafts } from "@/lib/accounting/input";
import { deleteDraftJournal, updateDraftJournal } from "@/lib/accounting/posting";
import { serializeEntry } from "@/lib/accounting/serialize";
import { journalSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

const detailInclude = {
  lines: {
    orderBy: { lineNumber: "asc" },
    include: { account: { select: { code: true, name: true } } },
  },
  reversedBy: { select: { id: true, number: true } },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
} satisfies Prisma.JournalEntryInclude;

export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({ where: { id }, include: detailInclude });
  if (!entry) return NextResponse.json({ error: "Journal not found" }, { status: 404 });

  return NextResponse.json(serializeEntry(entry));
});

export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = journalSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    await prisma.$transaction((tx) =>
      updateDraftJournal(
        tx,
        id,
        {
          date: toLedgerDate(data.date),
          memo: data.memo,
          reference: data.reference ?? null,
          lines: toLineDrafts(data.lines),
        },
        guard.ctx.actor
      )
    );

    const full = await prisma.journalEntry.findUniqueOrThrow({ where: { id }, include: detailInclude });
    return NextResponse.json(serializeEntry(full));
  } catch (error) {
    return booksError(error);
  }
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.$transaction((tx) => deleteDraftJournal(tx, id, guard.ctx.actor));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
