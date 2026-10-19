import { Prisma } from "@prisma/client";
import { fromPence, sumPence, toPence, type Pence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import {
  allocationAmount,
  amountDue,
  assertCreditNoteTransition,
  creditNotePostingLines,
  type CreditNoteStatus,
} from "./credit-note";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "./dates";
import { AccountingError } from "./errors";
import { enforceSeparation } from "./separation";
import {
  formatInvoiceNumber,
  priceInvoice,
  validateInvoice,
  type InvoiceLineInput,
} from "./invoice";
import { accountIdForCode, lineRows, userId } from "./invoices";
import { assertAllocationDate } from "./payment";
import { lockInvoice, refreshInvoiceStatus, releaseAllocations, settledByInvoice } from "./settlement";
import { COMPANY_SETTINGS_ID, postNewJournal, reverseJournal } from "./posting";
import { effectiveShippingAddress, normaliseAddress, toMilli } from "./sales";

/**
 * The only code that writes credit notes and credit allocations. Like the
 * invoice service, everything takes the caller's transaction client so the
 * document, its journal, the allocation and the audit rows commit together.
 */

type Tx = Prisma.TransactionClient;
/** A transaction or the plain client: the balance helpers are read-only. */
type Reader = Pick<Tx, "creditAllocation" | "paymentAllocation">;

const withLines = {
  lines: { orderBy: { lineNumber: "asc" } },
} satisfies Prisma.CreditNoteInclude;

/** Everything the detail screen and API show: lines, journal, the invoice and allocations. */
export const creditNoteDetail = {
  lines: { orderBy: { lineNumber: "asc" } },
  journalEntry: { select: { id: true, number: true } },
  invoice: { select: { id: true, number: true } },
  allocations: {
    orderBy: { createdAt: "asc" },
    include: {
      invoice: { select: { id: true, number: true } },
      refund: { select: { id: true, date: true } },
    },
  },
} satisfies Prisma.CreditNoteInclude;

export interface CreditNoteInput {
  contactId: string;
  /** The invoice being corrected. Omitted for a credit not tied to one. */
  invoiceId?: string | null;
  issueDate: Date;
  reference?: string | null;
  notes?: string | null;
  projectId?: string | null;
  lines: InvoiceLineInput[];
}

function throwIfProblems(problems: ReturnType<typeof validateInvoice>, verb: string): void {
  if (problems.length > 0) {
    throw new AccountingError("INVALID_CREDIT_NOTE", `Credit note cannot be ${verb}`, 422, problems);
  }
}

/**
 * Who the credit is for, as it will print. Raised against an invoice it
 * copies that invoice's snapshot — the credit goes to whoever was billed —
 * otherwise it snapshots the contact as it stands.
 */
async function resolveParties(tx: Tx, input: CreditNoteInput) {
  const contact = await tx.contact.findUnique({ where: { id: input.contactId } });
  if (!contact) throw new AccountingError("UNKNOWN_CONTACT", "That customer does not exist", 422);
  if (contact.type === "SUPPLIER") {
    throw new AccountingError(
      "NOT_A_CUSTOMER",
      `${contact.name} is a supplier; a credit note is for a customer`,
      422
    );
  }

  if (!input.invoiceId) {
    // An archived customer may still be owed a credit, so only new
    // standalone credit is refused for them, not a correction.
    if (contact.isArchived) {
      throw new AccountingError(
        "ARCHIVED_CONTACT",
        `${contact.name} is archived; restore them before crediting`,
        422
      );
    }
    return {
      contact,
      snapshot: {
        billToName: contact.name,
        billToAddress: normaliseAddress(contact.billingAddress),
        shipToAddress: effectiveShippingAddress(contact),
        taxId: contact.taxId,
      },
    };
  }

  const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) throw new AccountingError("UNKNOWN_INVOICE", "That invoice does not exist", 422);
  if (invoice.contactId !== contact.id) {
    throw new AccountingError(
      "WRONG_CUSTOMER",
      `Invoice ${invoice.number ?? "(draft)"} is not ${contact.name}'s`,
      422
    );
  }
  assertCreditable(invoice);
  return {
    contact,
    snapshot: {
      billToName: invoice.billToName,
      billToAddress: invoice.billToAddress,
      shipToAddress: invoice.shipToAddress,
      taxId: invoice.taxId,
    },
  };
}

function assertCreditable(invoice: { status: string; number: string | null }): void {
  if (invoice.status === "DRAFT") {
    throw new AccountingError(
      "NOT_CREDITABLE",
      "A draft invoice has nothing to credit: edit or delete it instead",
      409
    );
  }
  if (invoice.status === "VOID") {
    throw new AccountingError(
      "NOT_CREDITABLE",
      `Invoice ${invoice.number} is void: its sale has already been reversed`,
      409
    );
  }
}

export async function createDraftCreditNote(tx: Tx, input: CreditNoteInput, actor: AuditActor) {
  const { contact, snapshot } = await resolveParties(tx, input);
  throwIfProblems(validateInvoice(input, "draft", "credit note"), "saved");
  const priced = priceInvoice(input.lines);

  const note = await tx.creditNote.create({
    data: {
      contactId: contact.id,
      invoiceId: input.invoiceId ?? null,
      issueDate: input.issueDate,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      projectId: input.projectId ?? null,
      ...snapshot,
      subtotal: fromPence(priced.subtotal),
      total: fromPence(priced.total),
      createdById: userId(actor),
      lines: { create: lineRows(priced.lines) },
    },
    include: withLines,
  });

  await recordAudit(tx, {
    actor,
    action: "credit_note.create",
    entityType: "CreditNote",
    entityId: note.id,
    after: note,
  });
  return note;
}

async function loadDraft(tx: Tx, id: string, verb: string) {
  const existing = await tx.creditNote.findUnique({ where: { id }, include: withLines });
  if (!existing) throw new AccountingError("NOT_FOUND", "Credit note not found", 404);
  if (existing.status !== "DRAFT") {
    throw new AccountingError(
      "NOT_EDITABLE",
      `Credit note ${existing.number} is ${existing.status.toLowerCase()} and cannot be ${verb}`,
      409
    );
  }
  return existing;
}

export async function updateDraftCreditNote(
  tx: Tx,
  id: string,
  input: CreditNoteInput,
  actor: AuditActor
) {
  const existing = await loadDraft(tx, id, "edited");
  const { contact, snapshot } = await resolveParties(tx, input);
  throwIfProblems(validateInvoice(input, "draft", "credit note"), "saved");
  const priced = priceInvoice(input.lines);

  await tx.creditNoteLine.deleteMany({ where: { creditNoteId: id } });
  const note = await tx.creditNote.update({
    where: { id },
    data: {
      contactId: contact.id,
      invoiceId: input.invoiceId ?? null,
      issueDate: input.issueDate,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      projectId: input.projectId ?? null,
      ...snapshot,
      subtotal: fromPence(priced.subtotal),
      total: fromPence(priced.total),
      lines: { create: lineRows(priced.lines) },
    },
    include: withLines,
  });

  await recordAudit(tx, {
    actor,
    action: "credit_note.update",
    entityType: "CreditNote",
    entityId: id,
    before: existing,
    after: note,
  });
  return note;
}

export async function deleteDraftCreditNote(tx: Tx, id: string, actor: AuditActor): Promise<void> {
  const existing = await loadDraft(tx, id, "deleted");
  await tx.creditNote.delete({ where: { id } });
  await recordAudit(tx, {
    actor,
    action: "credit_note.delete",
    entityType: "CreditNote",
    entityId: id,
    before: existing,
  });
}

/** Pence already applied to each invoice by credit notes (payments not included). */
export async function creditedByInvoice(tx: Reader, invoiceIds: string[]): Promise<Map<string, Pence>> {
  return (await settledByInvoice(tx, invoiceIds)).credited;
}

/** Pence already allocated from each credit note. */
export async function allocatedByCreditNote(
  tx: Reader,
  creditNoteIds: string[]
): Promise<Map<string, Pence>> {
  if (creditNoteIds.length === 0) return new Map();
  const rows = await tx.creditAllocation.groupBy({
    by: ["creditNoteId"],
    where: { creditNoteId: { in: creditNoteIds }, releasedOn: null },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.creditNoteId, r._sum.amount ? toPence(r._sum.amount) : 0]));
}

/**
 * Applies part of an approved credit note to an invoice of the same customer.
 * Omitting `amount` applies as much as both sides allow.
 *
 * Locks the invoice and then the credit note (the order the database guard
 * uses), so two credits racing for one invoice queue rather than both
 * passing the sum check.
 */
export async function allocateCredit(
  tx: Tx,
  input: { creditNoteId: string; invoiceId: string; amount?: Pence; date: Date },
  actor: AuditActor
) {
  await lockInvoice(tx, input.invoiceId);
  await tx.$queryRaw`SELECT 1 FROM "credit_notes" WHERE "id" = ${input.creditNoteId} FOR UPDATE`;

  const [note, invoice] = await Promise.all([
    tx.creditNote.findUnique({ where: { id: input.creditNoteId } }),
    tx.invoice.findUnique({ where: { id: input.invoiceId } }),
  ]);
  if (!note) throw new AccountingError("NOT_FOUND", "Credit note not found", 404);
  if (!invoice) throw new AccountingError("UNKNOWN_INVOICE", "That invoice does not exist", 422);
  if (note.status !== "APPROVED") {
    throw new AccountingError("NOT_ALLOCATABLE", "Only an approved credit note can be allocated", 409);
  }
  assertCreditable(invoice);
  if (invoice.contactId !== note.contactId) {
    throw new AccountingError(
      "WRONG_CUSTOMER",
      `Credit note ${note.number} and invoice ${invoice.number} are for different customers`,
      422
    );
  }

  const [allocated, settled] = await Promise.all([
    allocatedByCreditNote(tx, [note.id]),
    settledByInvoice(tx, [invoice.id]),
  ]);
  const creditRemaining = toPence(note.total) - (allocated.get(note.id) ?? 0);
  // What is still owed after credits *and* payments.
  const invoiceDue = amountDue(toPence(invoice.total), [settled.settled.get(invoice.id) ?? 0]);
  assertAllocationDate(input.date, [note.issueDate, invoice.issueDate]);
  const amount = allocationAmount({ requested: input.amount, creditRemaining, invoiceDue });
  if (amount === 0) {
    throw new AccountingError(
      "NOTHING_TO_ALLOCATE",
      creditRemaining === 0
        ? `Credit note ${note.number} is fully allocated`
        : `Invoice ${invoice.number} has nothing left to credit`,
      409
    );
  }

  const allocation = await tx.creditAllocation.create({
    data: {
      creditNoteId: note.id,
      invoiceId: invoice.id,
      amount: fromPence(amount),
      date: input.date,
      createdById: userId(actor),
    },
  });

  await recordAudit(tx, {
    actor,
    action: "credit_note.allocate",
    entityType: "CreditNote",
    entityId: note.id,
    after: allocation,
  });
  await refreshInvoiceStatus(tx, invoice.id, actor);

  return allocation;
}

/**
 * Approval takes the next CN number and posts Dr income / Cr trade debtors,
 * dated on the credit note's issue date. The number comes from the same
 * row-locked settings row as journal and invoice numbers, so a refused
 * approval rolls back without spending one.
 *
 * Raised against an invoice, the credit is then applied to it — as much as
 * the invoice still owes. Anything beyond that stays with the customer as
 * credit to allocate later.
 */
export async function approveCreditNote(tx: Tx, id: string, actor: AuditActor) {
  const existing = await tx.creditNote.findUnique({ where: { id }, include: withLines });
  if (!existing) throw new AccountingError("NOT_FOUND", "Credit note not found", 404);
  assertCreditNoteTransition(existing.status as CreditNoteStatus, "APPROVED");
  const { selfApproved } = await enforceSeparation(tx, { thing: "credit note", verb: "approve" }, userId(actor), [existing.createdById]);

  const lines: InvoiceLineInput[] = existing.lines.map((line) => ({
    name: line.name,
    description: line.description,
    code: line.code,
    unit: line.unit,
    quantity: toMilli(line.quantity.toFixed()),
    unitPrice: toPence(line.unitPrice),
    productId: line.productId,
    incomeAccountId: line.incomeAccountId,
    vatCode: line.vatCode,
  }));
  throwIfProblems(validateInvoice({ lines }, "approve", "credit note"), "approved");

  if (existing.invoiceId) {
    const invoice = await tx.invoice.findUnique({ where: { id: existing.invoiceId } });
    if (invoice) assertCreditable(invoice);
  }

  const settings = await tx.$queryRaw<
    { creditNotePrefix: string; nextCreditNoteNumber: number; invoiceNumberPad: number }[]
  >`
    SELECT "creditNotePrefix", "nextCreditNoteNumber", "invoiceNumberPad"
      FROM "company_settings" WHERE "id" = ${COMPANY_SETTINGS_ID} FOR UPDATE
  `;
  if (settings.length === 0) {
    throw new AccountingError("NO_SETTINGS", "Company settings are missing", 500);
  }
  const { creditNotePrefix, nextCreditNoteNumber, invoiceNumberPad } = settings[0];
  const number = formatInvoiceNumber(creditNotePrefix, nextCreditNoteNumber, invoiceNumberPad);

  const priced = priceInvoice(lines);
  const postingLines = creditNotePostingLines(
    priced.lines.map((l) => ({ amount: l.amount, incomeAccountId: l.incomeAccountId ?? null })),
    await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS),
    await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.SALES)
  );

  const journal = await postNewJournal(
    tx,
    {
      date: toLedgerDate(existing.issueDate),
      memo: `Credit note ${number} — ${existing.billToName}`,
      reference: number,
      sourceType: "SYSTEM",
      sourceId: `credit-note:${existing.id}`,
      lines: postingLines.map((line) => ({
        ...line,
        description: existing.billToName,
        projectId: existing.projectId,
      })),
    },
    actor
  );

  const note = await tx.creditNote.update({
    where: { id },
    data: {
      status: "APPROVED",
      number,
      journalEntryId: journal.id,
      approvedById: userId(actor),
      approvedAt: new Date(),
    },
    include: withLines,
  });

  await tx.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { nextCreditNoteNumber: nextCreditNoteNumber + 1 },
  });

  await recordAudit(tx, {
    actor,
    action: "credit_note.approve",
    entityType: "CreditNote",
    entityId: id,
    before: existing,
    after: selfApproved ? { ...note, selfApproved: true } : note,
  });

  if (note.invoiceId) {
    const invoice = await tx.invoice.findUnique({ where: { id: note.invoiceId } });
    const settled = (await settledByInvoice(tx, [note.invoiceId])).settled.get(note.invoiceId) ?? 0;
    // Already settled (paid, or credited in full elsewhere): the credit stays
    // with the customer rather than failing the approval.
    if (invoice && amountDue(toPence(invoice.total), [settled]) > 0) {
      await allocateCredit(
        tx,
        {
          creditNoteId: id,
          invoiceId: note.invoiceId,
          // Settles from whichever document came second.
          date: toLedgerDate(note.issueDate > invoice.issueDate ? note.issueDate : invoice.issueDate),
        },
        actor
      );
    }
  }

  // Re-read, so the caller sees the allocation approval just made.
  return tx.creditNote.findUniqueOrThrow({ where: { id }, include: creditNoteDetail });
}

/**
 * Voiding reverses the credit note's journal and releases its allocations, so
 * the invoices it settled are owed again. The number stays spent.
 */
export async function voidCreditNote(tx: Tx, id: string, reason: string, actor: AuditActor) {
  const existing = await tx.creditNote.findUnique({
    where: { id },
    include: { ...withLines, allocations: true },
  });
  if (!existing) throw new AccountingError("NOT_FOUND", "Credit note not found", 404);
  assertCreditNoteTransition(existing.status as CreditNoteStatus, "VOID");

  // Money already paid back cannot be un-credited: the refund goes first.
  const liveAllocations = existing.allocations.filter((a) => a.releasedOn === null);
  const refunded = liveAllocations.filter((a) => a.refundId !== null);
  if (refunded.length > 0) {
    const live = await tx.customerPayment.count({
      where: { id: { in: refunded.map((a) => a.refundId!) }, status: "POSTED" },
    });
    if (live > 0) {
      throw new AccountingError(
        "REFUNDED",
        `Credit note ${existing.number} has been refunded to the customer: void the refund first`,
        409
      );
    }
  }

  const voidDate = toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE));
  if (existing.journalEntryId) {
    await reverseJournal(
      tx,
      existing.journalEntryId,
      {
        date: voidDate,
        memo: `Void credit note ${existing.number} — ${reason}`,
      },
      actor
    );
  }

  const note = await tx.creditNote.update({
    where: { id },
    data: { status: "VOID" },
    include: withLines,
  });

  // Released, not deleted — and the database only allows it once the credit
  // note is void.
  await releaseAllocations(tx, "credit_allocations", "creditNoteId", id, voidDate);
  for (const invoiceId of new Set(liveAllocations.flatMap((a) => (a.invoiceId ? [a.invoiceId] : [])))) {
    await refreshInvoiceStatus(tx, invoiceId, actor);
  }

  await recordAudit(tx, {
    actor,
    action: "credit_note.void",
    entityType: "CreditNote",
    entityId: id,
    before: existing,
    after: note,
    reason,
  });

  return tx.creditNote.findUniqueOrThrow({ where: { id }, include: creditNoteDetail });
}

export type CreditNoteWithLines = Prisma.CreditNoteGetPayload<{ include: typeof withLines }>;

/** Total of a set of allocations, in pence. */
export function allocationsTotal(allocations: { amount: Prisma.Decimal | string | number }[]): Pence {
  return sumPence(allocations.map((a) => toPence(a.amount)));
}
