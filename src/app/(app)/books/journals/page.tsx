export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { JournalsClient, type JournalRow } from "./journals-client";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ status?: string; from?: string; to?: string; page?: string }>;
}

export default async function JournalsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const params = await searchParams;
  const status = params.status === "DRAFT" || params.status === "POSTED" ? params.status : "";
  // A malformed date in the URL should not blow up the page.
  const parse = (value?: string) => {
    if (!value) return null;
    try {
      return toLedgerDate(value);
    } catch {
      return null;
    }
  };
  const from = parse(params.from);
  const to = parse(params.to);

  const where: Prisma.JournalEntryWhereInput = {
    ...(status ? { status } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  // Offset paging is fine here: the ordering is total (date, then id), and a
  // bookkeeper wants "page 3 of 12", not an infinite scroll.
  const total = await prisma.journalEntry.count({ where });
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Clamp, so a stale ?page= after a filter change lands on real rows
  // instead of an empty table that looks like "no journals".
  const page = Math.min(Math.max(1, Math.floor(Number(params.page)) || 1), lastPage);

  const [entries, accounts] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      include: { lines: { select: { debit: true } } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.ledgerAccount.findMany({
      where: { isArchived: false },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const rows: JournalRow[] = entries.map((entry) => ({
    id: entry.id,
    number: entry.number,
    date: ledgerDateKey(entry.date),
    memo: entry.memo,
    reference: entry.reference,
    status: entry.status,
    sourceType: entry.sourceType,
    totalDebit: entry.lines.reduce((sum, line) => sum + toPence(line.debit), 0),
  }));

  return (
    <JournalsClient
      initialEntries={rows}
      accounts={accounts}
      canPost={hasPermission(session, "books:post")}
      filters={{ status, from: from ? ledgerDateKey(from) : "", to: to ? ledgerDateKey(to) : "" }}
      pagination={{ page, pageSize: PAGE_SIZE, total }}
    />
  );
}
