export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { calendarDateKey, ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { buildTrialBalance } from "@/lib/accounting/trial-balance";
import { TrialBalanceClient } from "./trial-balance-client";

interface PageProps {
  searchParams: Promise<{ asAt?: string }>;
}

export default async function TrialBalancePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const query = await searchParams;
  const today = calendarDateKey(new Date(), BUSINESS_TIME_ZONE);
  let asAt: Date;
  try {
    asAt = toLedgerDate(query.asAt ?? today);
  } catch {
    asAt = toLedgerDate(today);
  }

  const [accounts, movements] = await Promise.all([
    prisma.ledgerAccount.findMany({ select: { id: true, code: true, name: true, type: true } }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "POSTED", date: { lte: asAt } } },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const trialBalance = buildTrialBalance(
    accounts,
    movements.map((m) => ({
      accountId: m.accountId,
      debit: toPence(m._sum.debit ?? 0),
      credit: toPence(m._sum.credit ?? 0),
    }))
  );

  return <TrialBalanceClient asAt={ledgerDateKey(asAt)} trialBalance={trialBalance} />;
}
