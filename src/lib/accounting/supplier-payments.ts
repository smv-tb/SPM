import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { fromPence, toPence, type Pence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { allocationAmount, amountDue } from "./credit-note";
import { billLabel, billSettledStatus, type BillStatus } from "./bill";
import { AccountingError } from "./errors";
import { accountIdForCode, userId } from "./invoices";
import { assertAllocationDate, supplierPaymentPostingLines } from "./payment";
import { resolveBankAccount, today } from "./payments";
import { postNewJournal, reverseJournal } from "./posting";

/**
 * The only code that writes supplier payments and their allocations to bills.
 * The mirror of customer receipts (payments.ts): a payment records money the
 * bank has already sent, so it posts as it is recorded, a mistake is voided,
 * and a void releases its allocations rather than deleting them. Everything
 * takes the caller's transaction, so the journal, the payment, the bills' new
 * status and the audit rows commit together.
 */

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "billPaymentAllocation">;

/** Everything the supplier payment screen and API show. */
export const supplierPaymentDetail = {
  contact: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, code: true, name: true } },
  journalEntry: { select: { id: true, number: true } },
  allocations: {
    orderBy: { createdAt: "asc" },
    include: { bill: { select: { id: true, supplierReference: true, supplierName: true } } },
  },
} satisfies Prisma.SupplierPaymentInclude;

export type SupplierPaymentWithDetail = Prisma.SupplierPaymentGetPayload<{ include: typeof supplierPaymentDetail }>;

/** What every bill query needs to report paid and due. */
export const billSettlementInclude = {
  paymentAllocations: { where: { releasedOn: null }, select: { amount: true } },
} satisfies Prisma.BillInclude;

async function sumBy(
  tx: Reader,
  by: "billId" | "paymentId",
  ids: string[]
): Promise<Map<string, Pence>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.billPaymentAllocation.groupBy({
    by: [by],
    where: { [by]: { in: ids }, releasedOn: null },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r[by], r._sum.amount ? toPence(r._sum.amount) : 0]));
}

/** Pence paid against each bill by live allocations. */
export function settledByBill(tx: Reader, billIds: string[]): Promise<Map<string, Pence>> {
  return sumBy(tx, "billId", billIds);
}

/** Pence already allocated from each supplier payment. */
export function allocatedBySupplierPayment(tx: Reader, paymentIds: string[]): Promise<Map<string, Pence>> {
  return sumBy(tx, "paymentId", paymentIds);
}

/** Locks a bill row: the first lock every allocation takes. */
async function lockBill(tx: Tx, billId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${billId} FOR UPDATE`;
}

/** Moves a bill to the status its payments imply, audited when it changes. */
export async function refreshBillStatus(tx: Tx, billId: string, actor: AuditActor): Promise<void> {
  const bill = await tx.bill.findUnique({ where: { id: billId } });
  if (!bill) return;
  const paid = (await settledByBill(tx, [billId])).get(billId) ?? 0;
  const status = billSettledStatus(bill.status as BillStatus, toPence(bill.total), paid);
  if (status === bill.status) return;

  await tx.bill.update({ where: { id: billId }, data: { status } });
  await recordAudit(tx, {
    actor,
    action: "bill.settle",
    entityType: "Bill",
    entityId: billId,
    before: { status: bill.status },
    after: { status },
  });
}

async function loadPayee(tx: Tx, contactId: string) {
  const contact = await tx.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new AccountingError("UNKNOWN_CONTACT", "That supplier does not exist", 422);
  if (contact.type === "CUSTOMER") {
    throw new AccountingError(
      "NOT_A_SUPPLIER",
      `${contact.name} is a customer; money to a customer is a refund`,
      422
    );
  }
  return contact;
}

export interface SupplierPaymentInput {
  contactId: string;
  date: Date;
  amount: Pence;
  bankAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** Bills to settle, in order. Omitted amounts take what each still owes. */
  allocations?: { billId: string; amount?: Pence }[];
}

/**
 * Records money paid to a supplier: posts Dr trade creditors / Cr bank on the
 * payment date, then applies it to the bills given. Whatever is not applied
 * is money paid on account, shown against the supplier on aged creditors.
 */
export async function recordSupplierPayment(tx: Tx, input: SupplierPaymentInput, actor: AuditActor) {
  const contact = await loadPayee(tx, input.contactId);
  const bank = await resolveBankAccount(tx, input.bankAccountId);
  const id = randomUUID();

  const journal = await postNewJournal(
    tx,
    {
      date: input.date,
      memo: `Payment to ${contact.name}`,
      reference: input.reference?.trim() || null,
      sourceType: "SYSTEM",
      sourceId: `supplier-payment:${id}`,
      lines: supplierPaymentPostingLines(
        input.amount,
        bank.id,
        await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.TRADE_CREDITORS)
      ).map((line) => ({ ...line, description: contact.name })),
    },
    actor
  );

  const payment = await tx.supplierPayment.create({
    data: {
      id,
      contactId: contact.id,
      date: input.date,
      amount: fromPence(input.amount),
      bankAccountId: bank.id,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      journalEntryId: journal.id,
      createdById: userId(actor),
    },
  });
  await recordAudit(tx, {
    actor,
    action: "supplier_payment.create",
    entityType: "SupplierPayment",
    entityId: id,
    after: payment,
  });

  for (const allocation of input.allocations ?? []) {
    await allocateSupplierPayment(
      tx,
      { paymentId: id, billId: allocation.billId, amount: allocation.amount, date: input.date },
      actor
    );
  }

  return tx.supplierPayment.findUniqueOrThrow({ where: { id }, include: supplierPaymentDetail });
}

/**
 * Applies part of a supplier payment to a bill from the same supplier.
 * Omitting `amount` applies as much as both sides allow. Locks the bill, then
 * the payment — the order the database guard uses.
 */
export async function allocateSupplierPayment(
  tx: Tx,
  input: { paymentId: string; billId: string; amount?: Pence; date: Date },
  actor: AuditActor
) {
  await lockBill(tx, input.billId);
  await tx.$queryRaw`SELECT 1 FROM "supplier_payments" WHERE "id" = ${input.paymentId} FOR UPDATE`;

  const [payment, bill] = await Promise.all([
    tx.supplierPayment.findUnique({ where: { id: input.paymentId } }),
    tx.bill.findUnique({ where: { id: input.billId } }),
  ]);
  if (!payment) throw new AccountingError("NOT_FOUND", "Supplier payment not found", 404);
  if (!bill) throw new AccountingError("UNKNOWN_BILL", "That bill does not exist", 422);
  if (payment.status !== "POSTED") {
    throw new AccountingError("NOT_ALLOCATABLE", "This payment is void", 409);
  }
  if (bill.status === "DRAFT" || bill.status === "VOID") {
    throw new AccountingError(
      "NOT_PAYABLE",
      bill.status === "DRAFT" ? "A draft bill cannot be paid: approve it first" : `${billLabel(bill)} is void`,
      409
    );
  }
  if (bill.contactId !== payment.contactId) {
    throw new AccountingError("WRONG_SUPPLIER", `${billLabel(bill)} is from a different supplier`, 422);
  }
  assertAllocationDate(input.date, [payment.date, bill.issueDate]);

  const [allocated, paid] = await Promise.all([
    allocatedBySupplierPayment(tx, [payment.id]),
    settledByBill(tx, [bill.id]),
  ]);
  const remaining = toPence(payment.amount) - (allocated.get(payment.id) ?? 0);
  const billDue = amountDue(toPence(bill.total), [paid.get(bill.id) ?? 0]);
  const amount = allocationAmount({
    requested: input.amount,
    creditRemaining: remaining,
    invoiceDue: billDue,
    source: "the payment",
    target: "the bill",
  });
  if (amount === 0) {
    throw new AccountingError(
      "NOTHING_TO_ALLOCATE",
      remaining === 0 ? "This payment is fully allocated" : `${billLabel(bill)} has nothing left to pay`,
      409
    );
  }

  const allocation = await tx.billPaymentAllocation.create({
    data: {
      paymentId: payment.id,
      billId: bill.id,
      amount: fromPence(amount),
      date: input.date,
      createdById: userId(actor),
    },
  });
  await recordAudit(tx, {
    actor,
    action: "supplier_payment.allocate",
    entityType: "SupplierPayment",
    entityId: payment.id,
    after: allocation,
  });
  await refreshBillStatus(tx, bill.id, actor);
  return allocation;
}

/**
 * Voids a supplier payment: reverses its journal, keeps the row, and releases
 * its allocations so the bills it paid are owed again.
 */
export async function voidSupplierPayment(tx: Tx, id: string, reason: string, actor: AuditActor) {
  const existing = await tx.supplierPayment.findUnique({ where: { id }, include: supplierPaymentDetail });
  if (!existing) throw new AccountingError("NOT_FOUND", "Supplier payment not found", 404);
  if (existing.status === "VOID") {
    throw new AccountingError("INVALID_STATUS", "This payment is already void", 409);
  }

  const voidDate = today();
  await reverseJournal(
    tx,
    existing.journalEntryId,
    { date: voidDate, memo: `Void payment to ${existing.contact.name} — ${reason}` },
    actor
  );
  await tx.supplierPayment.update({ where: { id }, data: { status: "VOID", voidedAt: new Date() } });

  // Released, not deleted, so a report as at an earlier date still sees
  // them; the guard only allows it once the payment is void.
  await tx.$executeRaw`
    UPDATE "bill_payment_allocations" SET "releasedOn" = GREATEST(${voidDate}::date, "date")
     WHERE "paymentId" = ${id} AND "releasedOn" IS NULL`;
  const billIds = new Set(existing.allocations.filter((a) => a.releasedOn === null).map((a) => a.billId));
  for (const billId of billIds) await refreshBillStatus(tx, billId, actor);

  const after = await tx.supplierPayment.findUniqueOrThrow({ where: { id }, include: supplierPaymentDetail });
  await recordAudit(tx, {
    actor,
    action: "supplier_payment.void",
    entityType: "SupplierPayment",
    entityId: id,
    before: existing,
    after,
    reason,
  });
  return after;
}
