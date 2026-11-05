export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { loadAgedCreditors } from "@/lib/accounting/aged-creditors-query";
import { AgedReport } from "@/components/books/AgedReport";

export default async function AgedCreditorsPage({ searchParams }: { searchParams: Promise<{ asAt?: string }> }) {
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

  return <AgedReport side="creditors" report={await loadAgedCreditors(prisma, asAt)} />;
}
