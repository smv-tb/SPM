import { Prisma } from "@prisma/client";
import { toPence, type Pence } from "@/lib/money";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { buildAgedDebtors, type AgedDebtors } from "./aged-debtors";

type Reader = Pick<Prisma.TransactionClient, "bill" | "supplierPayment" | "journalLine">;

const sum = (rows: { amount: Prisma.Decimal }[]): Pence =>
  rows.reduce((total, row) => total + toPence(row.amount), 0);

/**
 * Aged creditors as at a date: what we owed each supplier, by how late it
 * was. The mirror of `loadAgedDebtors`, read the same literal way — a bill or
 * payment voided after the date was still live on it, and an allocation
 * released by a later void still paid its bill on that date. The buckets and
 * totals are the same calculation as aged debtors; each row's "invoices" are
 * the supplier's bills, and unused credit is money paid on account.
 *
 * Also returns the trade creditors (2100) ledger balance at the same date,
 * credit-normal. The two agree unless a manual journal touched 2100.
 */
export async function loadAgedCreditors(
  db: Reader,
  asAt: Date
): Promise<AgedDebtors & { ledgerBalance: Pence; difference: Pence }> {
  const upTo = { lte: asAt };
  const voidedLater = { status: "VOID" as const, journalEntry: { is: { reversedBy: { is: { date: { gt: asAt } } } } } };
  const allocatedBy = {
    where: { date: upTo, OR: [{ releasedOn: null }, { releasedOn: { gt: asAt } }] },
    select: { amount: true },
  };

  const [bills, payments, ledger] = await Promise.all([
    db.bill.findMany({
      where: { issueDate: upTo, OR: [{ status: { notIn: ["DRAFT", "VOID"] } }, voidedLater] },
      select: {
        id: true,
        supplierReference: true,
        contactId: true,
        dueDate: true,
        total: true,
        contact: { select: { name: true } },
        paymentAllocations: allocatedBy,
      },
    }),
    db.supplierPayment.findMany({
      where: { date: upTo, OR: [{ status: "POSTED" }, voidedLater] },
      select: { contactId: true, amount: true, contact: { select: { name: true } }, allocations: allocatedBy },
    }),
    db.journalLine.aggregate({
      where: {
        account: { code: SYSTEM_ACCOUNT_CODES.TRADE_CREDITORS },
        entry: { status: "POSTED", date: upTo },
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const report = buildAgedDebtors(
    asAt,
    bills.map((bill) => ({
      id: bill.id,
      number: bill.supplierReference,
      contactId: bill.contactId,
      contactName: bill.contact.name,
      dueDate: bill.dueDate,
      outstanding: toPence(bill.total) - sum(bill.paymentAllocations),
    })),
    payments.map((payment) => ({
      contactId: payment.contactId,
      contactName: payment.contact.name,
      amount: toPence(payment.amount) - sum(payment.allocations),
    }))
  );

  const ledgerBalance = toPence(ledger._sum.credit ?? 0) - toPence(ledger._sum.debit ?? 0);
  return { ...report, ledgerBalance, difference: ledgerBalance - report.totals.balance };
}
