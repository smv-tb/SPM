import { Prisma } from "@prisma/client";
import { toPence, type Pence } from "@/lib/money";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { buildAgedDebtors, type AgedDebtors } from "./aged-debtors";

type Reader = Pick<
  Prisma.TransactionClient,
  "invoice" | "creditNote" | "customerPayment" | "creditAllocation" | "paymentAllocation" | "journalLine"
>;

const sum = (rows: { amount: Prisma.Decimal }[]): Pence =>
  rows.reduce((total, row) => total + toPence(row.amount), 0);

/**
 * Aged debtors as at a date, read from the documents and their dated
 * allocations — so the report for 31 October still says what was owed on
 * 31 October after later payments, credits and voids.
 *
 * "As at" is taken literally: a document voided after the date was still
 * live on it (it counts until its reversal journal's date), and an allocation
 * released by a later void still settled its invoice on that date.
 *
 * Also returns the trade debtors (1100) ledger balance at the same date. The
 * two agree unless a manual journal touched 1100.
 */
export async function loadAgedDebtors(
  db: Reader,
  asAt: Date
): Promise<AgedDebtors & { ledgerBalance: Pence; difference: Pence }> {
  const upTo = { lte: asAt };
  // Voided by a reversal dated after the day: still live on it.
  const voidedLater = { status: "VOID" as const, journalEntry: { is: { reversedBy: { is: { date: { gt: asAt } } } } } };
  // In force on the day: made by then, and not yet released.
  const allocatedBy = {
    where: { date: upTo, OR: [{ releasedOn: null }, { releasedOn: { gt: asAt } }] },
    select: { amount: true },
  };

  const [invoices, notes, receipts, ledger] = await Promise.all([
    db.invoice.findMany({
      where: {
        issueDate: upTo,
        OR: [{ status: { notIn: ["DRAFT", "VOID"] } }, voidedLater],
      },
      select: {
        id: true,
        number: true,
        contactId: true,
        dueDate: true,
        total: true,
        contact: { select: { name: true } },
        creditAllocations: allocatedBy,
        paymentAllocations: allocatedBy,
      },
    }),
    db.creditNote.findMany({
      where: { issueDate: upTo, OR: [{ status: "APPROVED" }, voidedLater] },
      select: {
        contactId: true,
        total: true,
        contact: { select: { name: true } },
        allocations: allocatedBy,
      },
    }),
    db.customerPayment.findMany({
      where: { kind: "RECEIPT", date: upTo, OR: [{ status: "POSTED" }, voidedLater] },
      select: {
        contactId: true,
        amount: true,
        contact: { select: { name: true } },
        allocations: allocatedBy,
      },
    }),
    db.journalLine.aggregate({
      where: {
        account: { code: SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS },
        entry: { status: "POSTED", date: upTo },
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const report = buildAgedDebtors(
    asAt,
    invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      contactId: invoice.contactId,
      contactName: invoice.contact.name,
      dueDate: invoice.dueDate,
      outstanding:
        toPence(invoice.total) - sum(invoice.creditAllocations) - sum(invoice.paymentAllocations),
    })),
    [
      ...notes.map((note) => ({
        contactId: note.contactId,
        contactName: note.contact.name,
        amount: toPence(note.total) - sum(note.allocations),
      })),
      ...receipts.map((receipt) => ({
        contactId: receipt.contactId,
        contactName: receipt.contact.name,
        amount: toPence(receipt.amount) - sum(receipt.allocations),
      })),
    ]
  );

  const ledgerBalance = toPence(ledger._sum.debit ?? 0) - toPence(ledger._sum.credit ?? 0);
  return { ...report, ledgerBalance, difference: ledgerBalance - report.totals.balance };
}
