export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { ledgerDateKey } from "@/lib/accounting/dates";
import { SYSTEM_ACCOUNT_CODES } from "@/lib/accounting/chart";
import { reconcileView } from "@/lib/accounting/reconciliation";
import { serializeBankAccount } from "@/lib/accounting/serialize";
import { ReconcileClient } from "./reconcile-client";

export default async function ReconcilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const account = await prisma.bankAccount.findUnique({
    where: { id },
    include: { ledgerAccount: { select: { code: true, name: true } } },
  });
  if (!account) notFound();

  const [view, accounts, recent] = await Promise.all([
    reconcileView(prisma, id),
    // Where a line with nothing in the books can be posted: any live account
    // but trade debtors (customers go through invoices) and this bank itself.
    prisma.ledgerAccount.findMany({
      where: { isArchived: false, id: { not: account.ledgerAccountId }, code: { not: SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
    prisma.bankReconciliation.findMany({
      where: { bankAccountId: id },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        statementLines: { select: { date: true, description: true, amount: true } },
        journalLines: { include: { journalLine: { include: { entry: { select: { id: true, memo: true, number: true } } } } } },
      },
    }),
  ]);

  return (
    <ReconcileClient
      account={serializeBankAccount(account)}
      view={view}
      accounts={accounts}
      recent={recent.map((r) => ({
        id: r.id,
        method: r.method,
        createdAt: r.createdAt.toISOString(),
        statement: r.statementLines.map((l) => ({
          date: ledgerDateKey(l.date),
          description: l.description,
          amount: toPence(l.amount),
        })),
        books: r.journalLines.map((j) => ({
          entryId: j.journalLine.entry.id,
          label: j.journalLine.entry.memo,
          number: j.journalLine.entry.number,
        })),
      }))}
      canReconcile={hasPermission(session, "books:post")}
    />
  );
}
