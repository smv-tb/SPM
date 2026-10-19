import { Prisma } from "@prisma/client";
import { fromPence, toPence, type Pence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { calendarDateKey, toLedgerDate } from "./dates";
import { AccountingError } from "./errors";
import { enforceSeparation } from "./separation";
import {
  assertTransition,
  formatInvoiceNumber,
  invoicePostingLines,
  isEditable,
  priceInvoice,
  validateInvoice,
  type InvoiceLineInput,
  type InvoiceStatus,
} from "./invoice";
import { COMPANY_SETTINGS_ID, postNewJournal, reverseJournal } from "./posting";
import { dueDateFrom, effectiveShippingAddress, fromMilli, normaliseAddress, toMilli } from "./sales";

/**
 * The only code that writes invoices. Like the posting service, everything
 * takes the caller's transaction client, so the invoice, the journal it
 * raises and the audit row commit or roll back together.
 */

type Tx = Prisma.TransactionClient;

const withLines = { lines: { orderBy: { lineNumber: "asc" } } } satisfies Prisma.InvoiceInclude;

export interface InvoiceInput {
  contactId: string;
  issueDate: Date;
  /** Omitted means "use the customer's default terms". */
  paymentTermsDays?: number;
  reference?: string | null;
  notes?: string | null;
  projectId?: string | null;
  lines: InvoiceLineInput[];
}

export function userId(actor: AuditActor): string | null {
  return actor.type === "USER" ? actor.id : null;
}

function throwIfProblems(problems: ReturnType<typeof validateInvoice>, verb: string): void {
  if (problems.length > 0) {
    throw new AccountingError("INVALID_INVOICE", `Invoice cannot be ${verb}`, 422, problems);
  }
}

async function loadCustomer(tx: Tx, contactId: string) {
  const contact = await tx.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new AccountingError("UNKNOWN_CONTACT", "That customer does not exist", 422);
  if (contact.isArchived) {
    throw new AccountingError(
      "ARCHIVED_CONTACT",
      `${contact.name} is archived; restore them before invoicing`,
      422
    );
  }
  if (contact.type === "SUPPLIER") {
    throw new AccountingError(
      "NOT_A_CUSTOMER",
      `${contact.name} is a supplier; set them to customer (or both) to invoice them`,
      422
    );
  }
  return contact;
}

/** Priced lines as rows; shared with credit notes, whose lines have the same shape. */
export function lineRows(lines: ReturnType<typeof priceInvoice>["lines"]) {
  return lines.map((line, i) => ({
    lineNumber: i + 1,
    productId: line.productId ?? null,
    code: line.code?.trim() || null,
    name: line.name.trim(),
    description: line.description?.trim() || null,
    unit: line.unit.trim(),
    quantity: fromMilli(line.quantity),
    unitPrice: fromPence(line.unitPrice),
    amount: fromPence(line.amount),
    vatCode: line.vatCode ?? null,
    incomeAccountId: line.incomeAccountId ?? null,
  }));
}

/**
 * The customer as billed, frozen onto the invoice. A later change of address
 * must not rewrite a document that has already gone out.
 */
function customerSnapshot(contact: {
  name: string;
  billingAddress: string | null;
  shippingAddress: string | null;
  taxId: string | null;
}) {
  return {
    billToName: contact.name,
    billToAddress: normaliseAddress(contact.billingAddress),
    shipToAddress: effectiveShippingAddress(contact),
    taxId: contact.taxId,
  };
}

export async function createDraftInvoice(tx: Tx, input: InvoiceInput, actor: AuditActor) {
  const contact = await loadCustomer(tx, input.contactId);
  throwIfProblems(validateInvoice(input, "draft"), "saved");

  const terms = input.paymentTermsDays ?? contact.paymentTermsDays;
  const priced = priceInvoice(input.lines);

  const invoice = await tx.invoice.create({
    data: {
      contactId: contact.id,
      issueDate: input.issueDate,
      paymentTermsDays: terms,
      dueDate: dueDateFrom(input.issueDate, terms),
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      projectId: input.projectId ?? null,
      ...customerSnapshot(contact),
      subtotal: fromPence(priced.subtotal),
      total: fromPence(priced.total),
      createdById: userId(actor),
      lines: { create: lineRows(priced.lines) },
    },
    include: withLines,
  });

  await recordAudit(tx, {
    actor,
    action: "invoice.create",
    entityType: "Invoice",
    entityId: invoice.id,
    after: invoice,
  });

  return invoice;
}

export async function updateDraftInvoice(tx: Tx, id: string, input: InvoiceInput, actor: AuditActor) {
  const existing = await tx.invoice.findUnique({ where: { id }, include: withLines });
  if (!existing) throw new AccountingError("NOT_FOUND", "Invoice not found", 404);
  if (!isEditable(existing.status)) {
    throw new AccountingError(
      "NOT_EDITABLE",
      `Invoice ${existing.number} is approved: correct it with a credit note, not an edit`,
      409
    );
  }

  const contact = await loadCustomer(tx, input.contactId);
  throwIfProblems(validateInvoice(input, "draft"), "saved");

  const terms = input.paymentTermsDays ?? contact.paymentTermsDays;
  const priced = priceInvoice(input.lines);

  // Lines are replaced wholesale: a draft's line numbers are positions, not
  // identities, so matching them up would invent history that isn't there.
  await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });

  const invoice = await tx.invoice.update({
    where: { id },
    data: {
      contactId: contact.id,
      issueDate: input.issueDate,
      paymentTermsDays: terms,
      dueDate: dueDateFrom(input.issueDate, terms),
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      projectId: input.projectId ?? null,
      ...customerSnapshot(contact),
      subtotal: fromPence(priced.subtotal),
      total: fromPence(priced.total),
      lines: { create: lineRows(priced.lines) },
    },
    include: withLines,
  });

  await recordAudit(tx, {
    actor,
    action: "invoice.update",
    entityType: "Invoice",
    entityId: id,
    before: existing,
    after: invoice,
  });

  return invoice;
}

export async function deleteDraftInvoice(tx: Tx, id: string, actor: AuditActor): Promise<void> {
  const existing = await tx.invoice.findUnique({ where: { id }, include: withLines });
  if (!existing) throw new AccountingError("NOT_FOUND", "Invoice not found", 404);
  if (!isEditable(existing.status)) {
    throw new AccountingError(
      "NOT_EDITABLE",
      `Invoice ${existing.number} is approved and cannot be deleted; void it instead`,
      409
    );
  }

  await tx.invoice.delete({ where: { id } });
  // Full snapshot, lines included: after this the audit log is the only record.
  await recordAudit(tx, {
    actor,
    action: "invoice.delete",
    entityType: "Invoice",
    entityId: id,
    before: existing,
  });
}

export async function accountIdForCode(tx: Tx, code: string): Promise<string> {
  const account = await tx.ledgerAccount.findUnique({ where: { code } });
  if (!account) {
    throw new AccountingError(
      "MISSING_ACCOUNT",
      `Account ${code} is missing from the chart of accounts`,
      500
    );
  }
  return account.id;
}

/**
 * Approval is the moment an invoice becomes a document: it takes the next
 * number in the sequence and posts Dr trade debtors / Cr income.
 *
 * The number comes from the same row-locked settings row the journal counter
 * uses, so concurrent approvals queue rather than collide, and a refused
 * approval rolls the whole transaction back — number included.
 */
export async function approveInvoice(tx: Tx, id: string, actor: AuditActor) {
  const existing = await tx.invoice.findUnique({ where: { id }, include: withLines });
  if (!existing) throw new AccountingError("NOT_FOUND", "Invoice not found", 404);
  assertTransition(existing.status as InvoiceStatus, "APPROVED");
  // Whoever raised it can't also approve it when a second approver is required.
  const { selfApproved } = await enforceSeparation(tx, { thing: "invoice", verb: "approve" }, userId(actor), [existing.createdById]);

  const lines: InvoiceLineInput[] = existing.lines.map((line) => ({
    name: line.name,
    description: line.description,
    code: line.code,
    unit: line.unit,
    // Decimal → exact string → thousandths; never through a float.
    quantity: toMilli(line.quantity.toFixed()),
    unitPrice: toPence(line.unitPrice),
    productId: line.productId,
    incomeAccountId: line.incomeAccountId,
    vatCode: line.vatCode,
  }));
  throwIfProblems(validateInvoice({ lines }, "approve"), "approved");

  const settings = await tx.$queryRaw<{ invoicePrefix: string; nextInvoiceNumber: number; invoiceNumberPad: number }[]>`
    SELECT "invoicePrefix", "nextInvoiceNumber", "invoiceNumberPad"
      FROM "company_settings" WHERE "id" = ${COMPANY_SETTINGS_ID} FOR UPDATE
  `;
  if (settings.length === 0) {
    throw new AccountingError("NO_SETTINGS", "Company settings are missing", 500);
  }
  const { invoicePrefix, nextInvoiceNumber, invoiceNumberPad } = settings[0];
  const number = formatInvoiceNumber(invoicePrefix, nextInvoiceNumber, invoiceNumberPad);

  const priced = priceInvoice(lines);
  const postingLines = invoicePostingLines(
    priced.lines.map((l) => ({ amount: l.amount, incomeAccountId: l.incomeAccountId ?? null })),
    await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS),
    await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.SALES)
  );

  const journal = await postNewJournal(
    tx,
    {
      date: toLedgerDate(existing.issueDate),
      memo: `Invoice ${number} — ${existing.billToName}`,
      reference: number,
      sourceType: "SYSTEM",
      sourceId: `invoice:${existing.id}`,
      lines: postingLines.map((line) => ({
        ...line,
        description: existing.billToName,
        projectId: existing.projectId,
      })),
    },
    actor
  );

  const invoice = await tx.invoice.update({
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
    data: { nextInvoiceNumber: nextInvoiceNumber + 1 },
  });

  await recordAudit(tx, {
    actor,
    action: "invoice.approve",
    entityType: "Invoice",
    entityId: id,
    before: existing,
    // Marked when the raiser approved their own (allowed only while the setting is off), so it can be reviewed.
    after: selfApproved ? { ...invoice, selfApproved: true } : invoice,
  });

  return invoice;
}

/** Records that the invoice actually went out — a separate date from issue. */
export async function markInvoiceSent(tx: Tx, id: string, sentAt: Date, actor: AuditActor) {
  const existing = await tx.invoice.findUnique({ where: { id }, include: withLines });
  if (!existing) throw new AccountingError("NOT_FOUND", "Invoice not found", 404);

  // Credited (or, from 4.5, paid) before it went out: record the date, but
  // keep the status, which says how much is settled.
  const status = existing.status as InvoiceStatus;
  const settled = status === "PART_PAID" || status === "PAID";
  if (settled && existing.sentAt) {
    throw new AccountingError("ALREADY_SENT", `Invoice ${existing.number} is already marked sent`, 409);
  }
  if (!settled) assertTransition(status, "SENT");

  const invoice = await tx.invoice.update({
    where: { id },
    data: { status: settled ? status : "SENT", sentAt },
    include: withLines,
  });

  await recordAudit(tx, {
    actor,
    action: "invoice.send",
    entityType: "Invoice",
    entityId: id,
    before: existing,
    after: invoice,
  });

  return invoice;
}

/**
 * Voiding an approved invoice reverses its journal rather than deleting
 * anything: the number stays used, and the books show both the sale and its
 * cancellation. A draft is simply marked void.
 */
export async function voidInvoice(tx: Tx, id: string, reason: string, actor: AuditActor) {
  const existing = await tx.invoice.findUnique({ where: { id }, include: withLines });
  if (!existing) throw new AccountingError("NOT_FOUND", "Invoice not found", 404);
  // Voiding reverses the whole sale; a credit note already reverses part of
  // it, so both together would credit the customer twice.
  const credited = await tx.creditAllocation.findFirst({
    where: { invoiceId: id, releasedOn: null },
    include: { creditNote: { select: { number: true } } },
  });
  if (credited) {
    throw new AccountingError(
      "CREDITED",
      `Credit note ${credited.creditNote.number} is allocated to ${existing.number}: void the credit note first, or credit the rest instead of voiding`,
      409
    );
  }
  if (await tx.paymentAllocation.count({ where: { invoiceId: id, releasedOn: null } })) {
    throw new AccountingError(
      "PAID",
      `${existing.number} has payments against it: void those first, or credit what is unpaid instead`,
      409
    );
  }
  assertTransition(existing.status as InvoiceStatus, "VOID");

  if (existing.journalEntryId) {
    await reverseJournal(
      tx,
      existing.journalEntryId,
      {
        date: toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE)),
        memo: `Void invoice ${existing.number} — ${reason}`,
      },
      actor
    );
  }

  const invoice = await tx.invoice.update({
    where: { id },
    data: { status: "VOID" },
    include: withLines,
  });

  await recordAudit(tx, {
    actor,
    action: "invoice.void",
    entityType: "Invoice",
    entityId: id,
    before: existing,
    after: invoice,
    reason,
  });

  return invoice;
}

export type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: typeof withLines }>;

/** Convenience for callers that only need the money as pence. */
export function invoiceTotalPence(invoice: { total: Prisma.Decimal | string | number }): Pence {
  return toPence(invoice.total);
}
