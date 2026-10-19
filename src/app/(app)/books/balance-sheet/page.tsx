export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { loadBalanceSheet } from "@/lib/accounting/balance-sheet-query";
import { balanceSheetRows } from "@/lib/accounting/balance-sheet";
import { BalanceSheetClient } from "./balance-sheet-client";

function dateOr(value: string | undefined, fallback: string | null): Date | null {
  try {
    return value ? toLedgerDate(value) : fallback ? toLedgerDate(fallback) : null;
  } catch {
    return fallback ? toLedgerDate(fallback) : null;
  }
}

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asAt?: string; compare?: string; zero?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const query = await searchParams;
  const asAt = dateOr(query.asAt, calendarDateKey(new Date(), BUSINESS_TIME_ZONE))!;
  const compare = dateOr(query.compare, null);
  const includeZero = query.zero === "1";

  const sheets = await Promise.all([asAt, ...(compare ? [compare] : [])].map((d) => loadBalanceSheet(prisma, d)));
  return (
    <BalanceSheetClient
      sheets={sheets.map((s) => ({
        asAt: s.asAt,
        yearStart: s.yearStart,
        balanced: s.balanced,
        totalAssets: s.totalAssets,
        totalLiabilitiesAndEquity: s.totalLiabilitiesAndEquity,
      }))}
      rows={balanceSheetRows(sheets, { includeZero })}
      includeZero={includeZero}
    />
  );
}
