export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { ledgerDateKey } from "@/lib/accounting/dates";
import { bankPosition } from "@/lib/accounting/statements";
import { serializeBankAccount } from "@/lib/accounting/serialize";
import { BankAccountClient } from "./bank-account-client";

const PAGE_SIZE = 50;

export default async function BankAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const account = await prisma.bankAccount.findUnique({
    where: { id },
    include: { ledgerAccount: { select: { code: true, name: true } } },
  });
  if (!account) notFound();

  const query = await searchParams;
  const total = await prisma.statementLine.count({ where: { bankAccountId: id } });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(query.page ?? "1", 10) || 1), pages);

  const [position, lines, imports] = await Promise.all([
    bankPosition(prisma, account),
    prisma.statementLine.findMany({
      where: { bankAccountId: id },
      orderBy: [{ date: "desc" }, { sequence: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.statementImport.findMany({
      where: { bankAccountId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { lines: { where: { reconciledAt: { not: null } } } } },
      },
    }),
  ]);

  return (
    <BankAccountClient
      account={serializeBankAccount(account, position)}
      lines={lines.map((l) => ({
        id: l.id,
        date: ledgerDateKey(l.date),
        type: l.type,
        description: l.description,
        amount: toPence(l.amount),
        balance: l.balance === null ? null : toPence(l.balance),
        reconciled: l.reconciledAt !== null,
      }))}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      imports={imports.map((i) => ({
        id: i.id,
        fileName: i.fileName,
        status: i.status,
        lineCount: i.lineCount,
        duplicateCount: i.duplicateCount,
        firstDate: i.firstDate ? ledgerDateKey(i.firstDate) : null,
        lastDate: i.lastDate ? ledgerDateKey(i.lastDate) : null,
        createdAt: i.createdAt.toISOString(),
        createdBy: i.createdBy?.name ?? null,
        reconciled: i._count.lines,
      }))}
      canImport={hasPermission(session, "books:post")}
    />
  );
}
