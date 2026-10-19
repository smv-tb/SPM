export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/constants";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { toLineDrafts } from "@/lib/accounting/input";
import { createDraftJournal, postNewJournal } from "@/lib/accounting/posting";
import { serializeEntry } from "@/lib/accounting/serialize";
import { journalSchema } from "@/schemas/books";

const listInclude = {
  lines: {
    orderBy: { lineNumber: "asc" },
    include: { account: { select: { code: true, name: true } } },
  },
  reversedBy: { select: { id: true, number: true } },
} satisfies Prisma.JournalEntryInclude;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const from = params.get("from");
  const to = params.get("to");
  const accountId = params.get("accountId");
  const cursor = params.get("cursor");
  const take = Math.min(Number(params.get("limit")) || DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

  try {
    const where: Prisma.JournalEntryWhereInput = {
      ...(status === "DRAFT" || status === "POSTED" ? { status } : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: toLedgerDate(from) } : {}),
              ...(to ? { lte: toLedgerDate(to) } : {}),
            },
          }
        : {}),
      ...(accountId ? { lines: { some: { accountId } } } : {}),
    };

    const entries = await prisma.journalEntry.findMany({
      where,
      include: listInclude,
      take: take + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      // Newest first by ledger date; `id` breaks ties so cursor paging cannot
      // drop or repeat an entry when several share a date.
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });

    const hasMore = entries.length > take;
    if (hasMore) entries.pop();

    return NextResponse.json({
      entries: entries.map(serializeEntry),
      nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
      hasMore,
    });
  } catch (error) {
    return booksError(error);
  }
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = journalSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  try {
    const input = {
      date: toLedgerDate(data.date),
      memo: data.memo,
      reference: data.reference ?? null,
      lines: toLineDrafts(data.lines),
    };

    const entry = await prisma.$transaction((tx) =>
      data.post
        ? postNewJournal(tx, input, guard.ctx.actor)
        : createDraftJournal(tx, input, guard.ctx.actor)
    );

    const full = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: listInclude,
    });
    return NextResponse.json(serializeEntry(full), { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
