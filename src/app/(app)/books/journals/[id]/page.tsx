export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { ledgerDateKey } from "@/lib/accounting/dates";
import { JournalDetailClient, type JournalDetail } from "./journal-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function JournalPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const [entry, accounts] = await Promise.all([
    prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
          include: { account: { select: { code: true, name: true } } },
        },
        reversedBy: { select: { id: true, number: true } },
        createdBy: { select: { name: true } },
        postedBy: { select: { name: true } },
      },
    }),
    prisma.ledgerAccount.findMany({
      where: { isArchived: false },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
  ]);

  if (!entry) notFound();

  const detail: JournalDetail = {
    id: entry.id,
    number: entry.number,
    date: ledgerDateKey(entry.date),
    memo: entry.memo,
    reference: entry.reference,
    status: entry.status,
    sourceType: entry.sourceType,
    reversesId: entry.reversesId,
    reversedBy: entry.reversedBy,
    postedAt: entry.postedAt?.toISOString() ?? null,
    postedByName: entry.postedBy?.name ?? null,
    createdByName: entry.createdBy?.name ?? null,
    lines: entry.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      description: line.description,
      debit: toPence(line.debit),
      credit: toPence(line.credit),
    })),
  };

  return (
    <JournalDetailClient
      entry={detail}
      accounts={accounts}
      canPost={hasPermission(session, "books:post")}
    />
  );
}
