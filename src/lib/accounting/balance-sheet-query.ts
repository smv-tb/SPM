import { Prisma } from "@prisma/client";
import { toPence } from "@/lib/money";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { financialYearContaining, ledgerDateKey } from "./dates";
import { loadAgedDebtors } from "./aged-debtors-query";
import { buildBalanceSheet, type BalanceSheet, type BalanceSheetDetail } from "./balance-sheet";
import { COMPANY_SETTINGS_ID } from "./posting";

type Reader = Pick<
  Prisma.TransactionClient,
  | "companySettings"
  | "ledgerAccount"
  | "journalLine"
  | "invoice"
  | "creditNote"
  | "customerPayment"
  | "creditAllocation"
  | "paymentAllocation"
>;

async function movements(db: Reader, where: Prisma.JournalEntryWhereInput) {
  const rows = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { entry: { status: "POSTED", ...where } },
    _sum: { debit: true, credit: true },
  });
  return rows.map((m) => ({
    accountId: m.accountId,
    debit: toPence(m._sum.debit ?? 0),
    credit: toPence(m._sum.credit ?? 0),
  }));
}

/**
 * The balance sheet as at a date, from posted journals only. Trade debtors
 * is broken down by customer from the aged debtors report on the same date;
 * anything on 1100 that no customer accounts for (a manual journal) is its
 * own line, so the breakdown always adds up to the account.
 */
export async function loadBalanceSheet(db: Reader, asAt: Date): Promise<BalanceSheet> {
  const settings = await db.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });
  const year = financialYearContaining(asAt, settings?.yearStartMonth ?? 11, settings?.yearStartDay ?? 1);

  const [accounts, toDate, beforeYear, aged] = await Promise.all([
    db.ledgerAccount.findMany({ select: { id: true, code: true, name: true, type: true } }),
    movements(db, { date: { lte: asAt } }),
    movements(db, { date: { lt: year.start } }),
    loadAgedDebtors(db, asAt),
  ]);

  const debtors: BalanceSheetDetail[] = aged.rows.map((r) => ({
    key: r.contactId,
    label: r.contactName,
    amount: r.balance,
  }));
  if (aged.difference !== 0) {
    debtors.push({ key: "unassigned", label: "Not on a customer's account", amount: aged.difference });
  }

  return buildBalanceSheet({
    asAt: ledgerDateKey(asAt),
    yearStart: ledgerDateKey(year.start),
    accounts,
    toDate,
    beforeYear,
    details: debtors.length > 0 ? { [SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS]: debtors } : undefined,
  });
}
