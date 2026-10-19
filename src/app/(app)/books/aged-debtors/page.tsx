export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { loadAgedDebtors } from "@/lib/accounting/aged-debtors-query";
import { AgedDebtorsClient } from "./aged-debtors-client";

export default async function AgedDebtorsPage({ searchParams }: { searchParams: Promise<{ asAt?: string }> }) {
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

  return <AgedDebtorsClient report={await loadAgedDebtors(prisma, asAt)} />;
}
