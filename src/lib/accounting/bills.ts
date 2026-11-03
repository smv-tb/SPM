import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { fromPence, toPence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { calendarDateKey, toLedgerDate } from "./dates";
import { AccountingError, type RuleProblem } from "./errors";
import { enforceSeparation } from "./separation";
import {
  assertTransition,
  billLabel,
  billPostingLines,
  isBillAccount,
  isEditable,
  priceBill,
  validateBill,
  type BillLineInput,
  type BillStatus,
} from "./bill";
import {
  MAX_ATTACHMENTS_PER_BILL,
  MAX_ATTACHMENT_BYTES,
  cleanAttachmentName,
  sniffAttachmentType,
} from "./bill-attachment";
import { accountIdForCode, userId } from "./invoices";
import { postNewJournal, reverseJournal } from "./posting";
import { dueDateFrom, fromMilli, toMilli } from "./sales";

/**
 * The only code that writes bills, their lines and their attachments. Like the
 * invoice service, everything takes the caller's transaction client, so the
 * bill, the journal it raises and the audit row commit or roll back together.
 */

type Tx = Prisma.TransactionClient;

/** Attachment metadata only: the bytes never go into an audit row or a response. */
export const attachmentMeta = {
  id: true,
  fileName: true,
  contentType: true,
  size: true,
  sha256: true,
  uploadedById: true,
  createdAt: true,
} satisfies Prisma.BillAttachmentSelect;

const withLines = {
  lines: { orderBy: { lineNumber: "asc" } },
  attachments: { select: attachmentMeta, orderBy: { createdAt: "asc" } },
} satisfies Prisma.BillInclude;

export type BillWithLines = Prisma.BillGetPayload<{ include: typeof withLines }>;

export interface BillInput {
  contactId: string;
  supplierReference?: string | null;
  issueDate: Date;
  /** Omitted means the bill date plus the supplier's usual terms. */
  dueDate?: Date | null;
  notes?: string | null;
  projectId?: string | null;
  lines: BillLineInput[];
}

function throwIfProblems(problems: RuleProblem[], verb: string): void {
  if (problems.length > 0) {
    throw new AccountingError("INVALID_BILL", `Bill cannot be ${verb}`, 422, problems);
  }
}

async function loadSupplier(tx: Tx, contactId: string) {
  const contact = await tx.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new AccountingError("UNKNOWN_CONTACT", "That supplier does not exist", 422);
  if (contact.isArchived) {
    throw new AccountingError("ARCHIVED_CONTACT", `${contact.name} is archived; restore them before entering a bill`, 422);
  }
  if (contact.type === "CUSTOMER") {
    throw new AccountingError(
      "NOT_A_SUPPLIER",
      `${contact.name} is a customer; set them to supplier (or both) to enter their bills`,
      422
    );
  }
  return contact;
}

/**
 * The same supplier invoice entered twice is the mistake that matters, so it
 * is refused with a message naming the existing bill. The partial unique
 * index `bills_supplier_reference_key` is the backstop for a race.
 */
async function assertReferenceFree(tx: Tx, contactId: string, reference: string | null, exceptId?: string) {
  if (!reference) return;
  const clash = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT "id", "status"::text AS "status" FROM "bills"
     WHERE "contactId" = ${contactId}
       AND lower(btrim("supplierReference")) = lower(btrim(${reference}))
       AND "status" <> 'VOID'
       AND "id" <> ${exceptId ?? ""}
     LIMIT 1`;
  if (clash.length > 0) throw duplicateReference(reference);
}

function duplicateReference(reference: string | null): AccountingError {
  return new AccountingError(
    "DUPLICATE_BILL",
    `This supplier already has a bill with reference ${reference ?? "the same reference"}. Open that one, or void it first if it was a mistake`,
    409
  );
}

/** Turns the duplicate-reference index firing in a race into the same 409 the check gives. */
export function asBillError(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta ?? {}).includes("supplier_reference")
  ) {
    return duplicateReference(null);
  }
  return error;
}

function lineRows(lines: ReturnType<typeof priceBill>["lines"]) {
  return lines.map((line, i) => ({
    lineNumber: i + 1,
    description: line.description.trim(),
    quantity: fromMilli(line.quantity),
    unitPrice: fromPence(line.unitPrice),
    amount: fromPence(line.amount),
    vatCode: line.vatCode ?? null,
    accountId: line.accountId || null,
  }));
}

/** Friendly refusals for accounts a line may not use; the trigger repeats the rule. */
async function assertLineAccounts(tx: Tx, lines: BillLineInput[]) {
  const ids = [...new Set(lines.map((l) => l.accountId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const accounts = new Map(
    (await tx.ledgerAccount.findMany({ where: { id: { in: ids } } })).map((a) => [a.id, a])
  );
  const problems: RuleProblem[] = [];
  lines.forEach((line, i) => {
    if (!line.accountId) return;
    const account = accounts.get(line.accountId);
    if (!account) {
      problems.push({ code: "UNKNOWN_ACCOUNT", message: "That account does not exist", line: i + 1 });
    } else if (account.isArchived) {
      problems.push({ code: "ARCHIVED_ACCOUNT", message: `${account.code} ${account.name} is archived`, line: i + 1 });
    } else if (!isBillAccount(account)) {
      problems.push({
        code: "WRONG_ACCOUNT",
        message: `${account.code} ${account.name} cannot take a bill line: choose an expense, or an asset such as equipment or a prepayment`,
        line: i + 1,
      });
    }
  });
  throwIfProblems(problems, "saved");
}

async function billData(tx: Tx, input: BillInput, exceptId?: string) {
  const contact = await loadSupplier(tx, input.contactId);
  const dueDate = input.dueDate ?? dueDateFrom(input.issueDate, contact.paymentTermsDays);
  throwIfProblems(validateBill({ lines: input.lines, issueDate: input.issueDate, dueDate }, "draft"), "saved");
  await assertLineAccounts(tx, input.lines);
  const supplierReference = input.supplierReference?.trim() || null;
  await assertReferenceFree(tx, contact.id, supplierReference, exceptId);

  const priced = priceBill(input.lines);
  return {
    contactId: contact.id,
    supplierReference,
    issueDate: input.issueDate,
    dueDate,
    notes: input.notes?.trim() || null,
    projectId: input.projectId ?? null,
    supplierName: contact.name,
    subtotal: fromPence(priced.subtotal),
    total: fromPence(priced.total),
    lines: { create: lineRows(priced.lines) },
  };
}

export async function createDraftBill(tx: Tx, input: BillInput, actor: AuditActor) {
  const bill = await tx.bill.create({
    data: { ...(await billData(tx, input)), createdById: userId(actor) },
    include: withLines,
  });

  await recordAudit(tx, { actor, action: "bill.create", entityType: "Bill", entityId: bill.id, after: bill });
  return bill;
}

async function loadBill(tx: Tx, id: string) {
  const bill = await tx.bill.findUnique({ where: { id }, include: withLines });
  if (!bill) throw new AccountingError("NOT_FOUND", "Bill not found", 404);
  return bill;
}

export async function updateDraftBill(tx: Tx, id: string, input: BillInput, actor: AuditActor) {
  const existing = await loadBill(tx, id);
  if (!isEditable(existing.status as BillStatus)) {
    throw new AccountingError("NOT_EDITABLE", "This bill is approved: it cannot be edited, only voided", 409);
  }

  const data = await billData(tx, input, id);
  // Lines are replaced wholesale: a draft's line numbers are positions, not identities.
  await tx.billLine.deleteMany({ where: { billId: id } });
  const bill = await tx.bill.update({ where: { id }, data, include: withLines });

  await recordAudit(tx, {
    actor,
    action: "bill.update",
    entityType: "Bill",
    entityId: id,
    before: existing,
    after: bill,
  });
  return bill;
}

export async function deleteDraftBill(tx: Tx, id: string, actor: AuditActor): Promise<void> {
  const existing = await loadBill(tx, id);
  if (!isEditable(existing.status as BillStatus)) {
    throw new AccountingError("NOT_EDITABLE", "This bill is approved and cannot be deleted; void it instead", 409);
  }

  // Attachments cascade with it; their metadata stays in this snapshot.
  await tx.bill.delete({ where: { id } });
  await recordAudit(tx, { actor, action: "bill.delete", entityType: "Bill", entityId: id, before: existing });
}

/**
 * Approval is the moment a bill reaches the books: it posts Dr each line's
 * account / Cr trade creditors on the bill date, after which the bill is fixed.
 */
export async function approveBill(tx: Tx, id: string, actor: AuditActor) {
  const existing = await loadBill(tx, id);
  assertTransition(existing.status as BillStatus, "APPROVED");
  // Whoever entered it can't also approve it when a second approver is required.
  const { selfApproved } = await enforceSeparation(tx, { thing: "bill", verb: "approve" }, userId(actor), [existing.createdById]);

  const lines: BillLineInput[] = existing.lines.map((line) => ({
    description: line.description,
    // Decimal → exact string → thousandths; never through a float.
    quantity: toMilli(line.quantity.toFixed()),
    unitPrice: toPence(line.unitPrice),
    accountId: line.accountId,
    vatCode: line.vatCode,
  }));
  throwIfProblems(validateBill({ lines }, "approve"), "approved");
  await assertLineAccounts(tx, lines);

  const priced = priceBill(lines);
  const label = billLabel(existing);
  const journal = await postNewJournal(
    tx,
    {
      date: toLedgerDate(existing.issueDate),
      memo: label,
      reference: existing.supplierReference,
      sourceType: "SYSTEM",
      sourceId: `bill:${existing.id}`,
      lines: billPostingLines(
        priced.lines.map((l) => ({ amount: l.amount, accountId: l.accountId as string })),
        await accountIdForCode(tx, SYSTEM_ACCOUNT_CODES.TRADE_CREDITORS)
      ).map((line) => ({ ...line, description: existing.supplierName, projectId: existing.projectId })),
    },
    actor
  );

  const bill = await tx.bill.update({
    where: { id },
    data: { status: "APPROVED", journalEntryId: journal.id, approvedById: userId(actor), approvedAt: new Date() },
    include: withLines,
  });

  await recordAudit(tx, {
    actor,
    action: "bill.approve",
    entityType: "Bill",
    entityId: id,
    before: existing,
    // Marked when the person who entered it approved it (allowed only while the setting is off).
    after: selfApproved ? { ...bill, selfApproved: true } : bill,
  });
  return bill;
}

/**
 * Voiding reverses the bill's journal rather than deleting anything: the books
 * show both the purchase and its cancellation, and the supplier's reference is
 * free to be entered again.
 */
export async function voidBill(tx: Tx, id: string, reason: string, actor: AuditActor) {
  const existing = await loadBill(tx, id);
  assertTransition(existing.status as BillStatus, "VOID");

  if (existing.journalEntryId) {
    await reverseJournal(
      tx,
      existing.journalEntryId,
      {
        date: toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE)),
        memo: `Void ${billLabel(existing)} — ${reason}`,
      },
      actor
    );
  }

  const bill = await tx.bill.update({ where: { id }, data: { status: "VOID" }, include: withLines });
  await recordAudit(tx, {
    actor,
    action: "bill.void",
    entityType: "Bill",
    entityId: id,
    before: existing,
    after: bill,
    reason,
  });
  return bill;
}

/**
 * Stores the supplier's document against a bill. The type is read from the
 * file's own bytes; anything that is not a PDF, PNG or JPEG is refused.
 */
export async function addBillAttachment(
  tx: Tx,
  billId: string,
  file: { fileName: string; bytes: Uint8Array },
  actor: AuditActor
) {
  const bill = await loadBill(tx, billId);
  if (bill.status === "VOID") {
    throw new AccountingError("BILL_VOID", "This bill is void: nothing more can be attached to it", 409);
  }
  if (bill.attachments.length >= MAX_ATTACHMENTS_PER_BILL) {
    throw new AccountingError("TOO_MANY_FILES", `A bill can have at most ${MAX_ATTACHMENTS_PER_BILL} attachments`, 422);
  }
  if (file.bytes.length === 0) throw new AccountingError("BAD_FILE", "The file is empty", 422);
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new AccountingError("BAD_FILE", "The file is larger than 5 MB", 422);
  const contentType = sniffAttachmentType(file.bytes);
  if (!contentType) {
    throw new AccountingError("BAD_FILE", "Attach the bill as a PDF, or a PNG or JPEG photo", 422);
  }

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const same = bill.attachments.find((a) => a.sha256 === sha256);
  if (same) throw new AccountingError("ALREADY_ATTACHED", `That file is already attached as ${same.fileName}`, 409);

  const attachment = await tx.billAttachment.create({
    data: {
      billId,
      fileName: cleanAttachmentName(file.fileName, contentType),
      contentType,
      size: file.bytes.length,
      sha256,
      data: Buffer.from(file.bytes),
      uploadedById: userId(actor),
    },
    select: attachmentMeta,
  });

  await recordAudit(tx, { actor, action: "bill.attach", entityType: "Bill", entityId: billId, after: attachment });
  return attachment;
}

/** Only while the bill is a draft: once approved its attachments are evidence. */
export async function removeBillAttachment(tx: Tx, billId: string, attachmentId: string, actor: AuditActor) {
  const bill = await loadBill(tx, billId);
  const attachment = bill.attachments.find((a) => a.id === attachmentId);
  if (!attachment) throw new AccountingError("NOT_FOUND", "Attachment not found", 404);
  if (!isEditable(bill.status as BillStatus)) {
    throw new AccountingError("NOT_EDITABLE", "This bill is approved: its attachments are kept as evidence", 409);
  }

  await tx.billAttachment.delete({ where: { id: attachmentId } });
  await recordAudit(tx, { actor, action: "bill.detach", entityType: "Bill", entityId: billId, before: attachment });
}
