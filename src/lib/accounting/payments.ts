import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { fromPence, toPence, type Pence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { allocationAmount, amountDue } from "./credit-note";
import { allocatedByCreditNote } from "./credit-notes";
import { calendarDateKey, toLedgerDate } from "./dates";
import { AccountingError } from "./errors";
import { accountIdForCode, userId } from "./invoices";
import { assertAllocationDate, isBankAccountCode, receiptPostingLines, refundPostingLines } from "./payment";
import { postNewJournal, reverseJournal } from "./posting";
import { lockInvoice, refreshInvoiceStatus, releaseAllocations, settledByInvoice } from "./settlement";

/**
 * The only code that writes customer payments and payment allocations. Every
 * function takes the caller's transaction, so the journal, the payment, its
 * allocations, the invoices' new status and the audit rows commit together.
 *
 * A payment has no draft: it records money the bank has already moved, so it
 * posts as it is recorded, and a mistake is voided, never edited.
 */

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "paymentAllocation">;

/** Everything the payment screen and API show. */
export const paymentDetail = {
  contact: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, code: true, name: true } },
  journalEntry: { select: { id: true, number: true } },
  allocations: {
    orderBy: { createdAt: "asc" },
    include: {
      invoice: { select: { id: true, number: true } },
      refund: { select: { id: true, date: true } },
    },
  },
  refundSources: {
    include: { payment: { select: { id: true, date: true, reference: true } } },
  },
  creditRefunds: {
    include: { creditNote: { select: { id: true, number: true } } },
  },
} satisfies Prisma.CustomerPaymentInclude;

export type PaymentWithDetail = Prisma.CustomerPaymentGetPayload<{ include: typeof paymentDetail }>;

/** Pence already allocated from each receipt, to invoices and refunds. */
export async function allocatedByPayment(tx: Reader, paymentIds: string[]): Promise<Map<string, Pence>> {
  if (paymentIds.length === 0) return new Map();
  const rows = await tx.paymentAllocation.groupBy({
    by: ["paymentId"],
    where: { paymentId: { in: paymentIds }, releasedOn: null },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.paymentId, r._sum.amount ? toPence(r._sum.amount) : 0]));
}

async function loadCustomer(tx: Tx, contactId: string) {
  const contact = await tx.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new AccountingError("UNKNOWN_CONTACT", "That customer does not exist", 422);
  if (contact.type === "SUPPLIER") {
    throw new AccountingError(
      "NOT_A_CUSTOMER",
      `${contact.name} is a supplier; supplier payments arrive with bills`,
      422
    );
  }
  return contact;
}

/** The account money moved through: the one asked for, or 1200. */
async function resolveBankAccount(tx: Tx, bankAccountId?: string | null) {
  const account = bankAccountId
    ? await tx.ledgerAccount.findUnique({ where: { id: bankAccountId } })
    : await tx.ledgerAccount.findUnique({ where: { code: SYSTEM_ACCOUNT_CODES.BANK } });
  if (!account) throw new AccountingError("UNKNOWN_ACCOUNT", "That bank account does not exist", 422);
  if (account.type !== "ASSET" || !isBankAccountCode(account.code)) {
    throw new AccountingError(
      "NOT_A_BANK_ACCOUNT",
      `${account.code} ${account.name} is not a bank account (12xx)`,
      422
    );
  }
  if (account.isArchived) {
    throw new AccountingError("ARCHIVED_ACCOUNT", `${account.code} ${account.name} is archived`, 422);
  }
  return account;
}

function today(): Date {
  return toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE));
}

export interface ReceiptInput {
  contactId: string;
  date: Date;
  amount: Pence;
  bankAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** Invoices to settle, in order. Omitted amounts take what each still owes. */
  allocations?: { invoiceId: string; amount?: Pence }[];
}

/**
 * Records money received: posts Dr bank / Cr trade debtors on the payment
 * date, then applies it to the invoices given. Whatever is not applied —
 * an overpayment, or a payment on account — stays as the customer's credit.
 */
export async function recordReceipt(tx: Tx, input: ReceiptInput, actor: AuditActor) {
  const contact = await loadCustomer(tx, input.contactId);
  const bank = await resolveBankAccount(tx, input.bankAccountId);
  const id = randomUUID();

  const journal = await postNewJournal(
    tx,
    {
      date: input.date,
      memo: `Payment from ${contact.name}`,
      reference: input.reference?.trim() || null,
      sourceType: "SYSTEM",
      sourceId: `payment:${id}`,
      lines: receiptPostingLines(
        input.amount,
        bank.id,
        await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS)
      ).map((line) => ({ ...line, description: contact.name })),
    },
    actor
  );

  const payment = await tx.customerPayment.create({
    data: {
      id,
      kind: "RECEIPT",
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
    action: "payment.create",
    entityType: "CustomerPayment",
    entityId: id,
    after: payment,
  });

  for (const allocation of input.allocations ?? []) {
    await allocatePayment(
      tx,
      { paymentId: id, invoiceId: allocation.invoiceId, amount: allocation.amount, date: input.date },
      actor
    );
  }

  return tx.customerPayment.findUniqueOrThrow({ where: { id }, include: paymentDetail });
}

/**
 * Applies part of a receipt to an invoice of the same customer. Omitting
 * `amount` applies as much as both sides allow. Locks the invoice, then the
 * payment — the order the database guard uses.
 */
export async function allocatePayment(
  tx: Tx,
  input: { paymentId: string; invoiceId: string; amount?: Pence; date: Date },
  actor: AuditActor
) {
  await lockInvoice(tx, input.invoiceId);
  await tx.$queryRaw`SELECT 1 FROM "customer_payments" WHERE "id" = ${input.paymentId} FOR UPDATE`;

  const [payment, invoice] = await Promise.all([
    tx.customerPayment.findUnique({ where: { id: input.paymentId } }),
    tx.invoice.findUnique({ where: { id: input.invoiceId } }),
  ]);
  if (!payment) throw new AccountingError("NOT_FOUND", "Payment not found", 404);
  if (!invoice) throw new AccountingError("UNKNOWN_INVOICE", "That invoice does not exist", 422);
  if (payment.kind !== "RECEIPT" || payment.status !== "POSTED") {
    throw new AccountingError("NOT_ALLOCATABLE", "Only a posted payment received can be allocated", 409);
  }
  if (invoice.status === "DRAFT" || invoice.status === "VOID") {
    throw new AccountingError(
      "NOT_PAYABLE",
      invoice.status === "DRAFT"
        ? "A draft invoice cannot be paid: approve it first"
        : `Invoice ${invoice.number} is void`,
      409
    );
  }
  if (invoice.contactId !== payment.contactId) {
    throw new AccountingError("WRONG_CUSTOMER", `Invoice ${invoice.number} is for a different customer`, 422);
  }
  assertAllocationDate(input.date, [payment.date, invoice.issueDate]);

  const [allocated, settled] = await Promise.all([
    allocatedByPayment(tx, [payment.id]),
    settledByInvoice(tx, [invoice.id]),
  ]);
  const remaining = toPence(payment.amount) - (allocated.get(payment.id) ?? 0);
  const invoiceDue = amountDue(toPence(invoice.total), [settled.settled.get(invoice.id) ?? 0]);
  const amount = allocationAmount({
    requested: input.amount,
    creditRemaining: remaining,
    invoiceDue,
    source: "the payment",
  });
  if (amount === 0) {
    throw new AccountingError(
      "NOTHING_TO_ALLOCATE",
      remaining === 0 ? "This payment is fully allocated" : `Invoice ${invoice.number} has nothing left to pay`,
      409
    );
  }

  const allocation = await tx.paymentAllocation.create({
    data: {
      paymentId: payment.id,
      invoiceId: invoice.id,
      amount: fromPence(amount),
      date: input.date,
      createdById: userId(actor),
    },
  });
  await recordAudit(tx, {
    actor,
    action: "payment.allocate",
    entityType: "CustomerPayment",
    entityId: payment.id,
    after: allocation,
  });
  await refreshInvoiceStatus(tx, invoice.id, actor);
  return allocation;
}

export interface RefundInput {
  /** Exactly one source of unused credit. */
  source: { creditNoteId: string } | { paymentId: string };
  date: Date;
  /** Omitted refunds everything the source has left. */
  amount?: Pence;
  bankAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
}

/**
 * Pays unused credit back to the customer — what is left of a credit note,
 * or of an overpayment. Posts Dr trade debtors / Cr bank and draws the same
 * amount from the source, so the refund is always fully accounted for (the
 * database checks that at commit).
 */
export async function recordRefund(tx: Tx, input: RefundInput, actor: AuditActor) {
  const fromNote = "creditNoteId" in input.source;
  const sourceId = fromNote
    ? (input.source as { creditNoteId: string }).creditNoteId
    : (input.source as { paymentId: string }).paymentId;

  // The refund row is new and invisible to anyone else until commit, so
  // locking the source first cannot deadlock against an allocation.
  let contactId: string;
  let sourceDate: Date;
  let remaining: Pence;
  let label: string;
  if (fromNote) {
    await tx.$queryRaw`SELECT 1 FROM "credit_notes" WHERE "id" = ${sourceId} FOR UPDATE`;
    const note = await tx.creditNote.findUnique({ where: { id: sourceId } });
    if (!note) throw new AccountingError("NOT_FOUND", "Credit note not found", 404);
    if (note.status !== "APPROVED") {
      throw new AccountingError("NOT_REFUNDABLE", "Only an approved credit note can be refunded", 409);
    }
    contactId = note.contactId;
    sourceDate = note.issueDate;
    remaining = toPence(note.total) - ((await allocatedByCreditNote(tx, [note.id])).get(note.id) ?? 0);
    label = `credit note ${note.number}`;
  } else {
    await tx.$queryRaw`SELECT 1 FROM "customer_payments" WHERE "id" = ${sourceId} FOR UPDATE`;
    const receipt = await tx.customerPayment.findUnique({ where: { id: sourceId } });
    if (!receipt) throw new AccountingError("NOT_FOUND", "Payment not found", 404);
    if (receipt.kind !== "RECEIPT" || receipt.status !== "POSTED") {
      throw new AccountingError("NOT_REFUNDABLE", "Only a posted payment received can be refunded", 409);
    }
    contactId = receipt.contactId;
    sourceDate = receipt.date;
    remaining = toPence(receipt.amount) - ((await allocatedByPayment(tx, [receipt.id])).get(receipt.id) ?? 0);
    label = "the payment";
  }

  if (remaining <= 0) {
    throw new AccountingError("NOTHING_TO_REFUND", `Nothing is left of ${label} to refund`, 409);
  }
  const amount = input.amount ?? remaining;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AccountingError("INVALID_AMOUNT", "Refund an amount more than zero", 422);
  }
  if (amount > remaining) {
    throw new AccountingError("OVER_REFUNDED", `That is more than is left of ${label}`, 422);
  }
  assertAllocationDate(input.date, [sourceDate]);

  const contact = await loadCustomer(tx, contactId);
  const bank = await resolveBankAccount(tx, input.bankAccountId);
  const id = randomUUID();

  const journal = await postNewJournal(
    tx,
    {
      date: input.date,
      memo: `Refund to ${contact.name}`,
      reference: input.reference?.trim() || null,
      sourceType: "SYSTEM",
      sourceId: `payment:${id}`,
      lines: refundPostingLines(
        amount,
        bank.id,
        await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS)
      ).map((line) => ({ ...line, description: contact.name })),
    },
    actor
  );

  const refund = await tx.customerPayment.create({
    data: {
      id,
      kind: "REFUND",
      contactId,
      date: input.date,
      amount: fromPence(amount),
      bankAccountId: bank.id,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      journalEntryId: journal.id,
      createdById: userId(actor),
    },
  });

  const allocation = { refundId: id, amount: fromPence(amount), date: input.date, createdById: userId(actor) };
  if (fromNote) {
    await tx.creditAllocation.create({ data: { ...allocation, creditNoteId: sourceId } });
  } else {
    await tx.paymentAllocation.create({ data: { ...allocation, paymentId: sourceId } });
  }

  await recordAudit(tx, {
    actor,
    action: "payment.refund",
    entityType: "CustomerPayment",
    entityId: id,
    after: { ...refund, source: fromNote ? { creditNoteId: sourceId } : { paymentId: sourceId } },
  });

  return tx.customerPayment.findUniqueOrThrow({ where: { id }, include: paymentDetail });
}

/**
 * Voids a receipt or a refund: reverses its journal, keeps the row, and
 * releases its allocations so the invoices it paid are owed again (or the
 * credit it refunded is available again). A receipt that has been partly
 * refunded cannot be voided until the refund is.
 */
export async function voidPayment(tx: Tx, id: string, reason: string, actor: AuditActor) {
  const existing = await tx.customerPayment.findUnique({ where: { id }, include: paymentDetail });
  if (!existing) throw new AccountingError("NOT_FOUND", "Payment not found", 404);
  if (existing.status === "VOID") {
    throw new AccountingError("INVALID_STATUS", "This payment is already void", 409);
  }

  const liveAllocations = existing.allocations.filter((a) => a.releasedOn === null);
  if (existing.kind === "RECEIPT") {
    const refundIds = liveAllocations.flatMap((a) => (a.refundId ? [a.refundId] : []));
    const liveRefunds = refundIds.length
      ? await tx.customerPayment.count({ where: { id: { in: refundIds }, status: "POSTED" } })
      : 0;
    if (liveRefunds > 0) {
      throw new AccountingError(
        "REFUNDED",
        "Part of this payment has been refunded: void the refund first",
        409
      );
    }
  }

  const voidDate = today();
  await reverseJournal(
    tx,
    existing.journalEntryId,
    {
      date: voidDate,
      memo: `Void ${existing.kind === "RECEIPT" ? "payment from" : "refund to"} ${existing.contact.name} — ${reason}`,
    },
    actor
  );

  await tx.customerPayment.update({
    where: { id },
    data: { status: "VOID", voidedAt: new Date() },
  });

  // Released, not deleted, so a report as at an earlier date still sees
  // them; the guards only allow it once the payment is void.
  if (existing.kind === "RECEIPT") {
    await releaseAllocations(tx, "payment_allocations", "paymentId", id, voidDate);
    for (const invoiceId of new Set(liveAllocations.flatMap((a) => (a.invoiceId ? [a.invoiceId] : [])))) {
      await refreshInvoiceStatus(tx, invoiceId, actor);
    }
  } else {
    await releaseAllocations(tx, "payment_allocations", "refundId", id, voidDate);
    await releaseAllocations(tx, "credit_allocations", "refundId", id, voidDate);
  }

  const after = await tx.customerPayment.findUniqueOrThrow({ where: { id }, include: paymentDetail });
  await recordAudit(tx, {
    actor,
    action: "payment.void",
    entityType: "CustomerPayment",
    entityId: id,
    before: existing,
    after,
    reason,
  });
  return after;
}
