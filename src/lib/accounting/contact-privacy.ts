import { Prisma, type PrismaClient } from "@prisma/client";
import { recordAudit, toAuditJson, type AuditActor } from "@/lib/audit";
import { AccountingError } from "@/lib/accounting/errors";
import { retentionVerdict, type RetentionVerdict } from "@/lib/accounting/privacy";

/**
 * Subject access and anonymisation for contacts (S3.6). The retention rule is
 * enforced by the database function `anonymise_contact` — this file asks it,
 * audits the outcome and turns its refusals into messages. See
 * docs/security/PRIVACY.md for the policy.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface ContactRetention {
  anonymisedAt: string | null;
  /** The last day documents about this contact must be kept; null when it has none. */
  retainUntil: string | null;
  hasOpenDocuments: boolean;
  verdict: RetentionVerdict;
}

interface RetentionRow {
  retain_until: string | null;
  open_documents: boolean;
  today: string;
  anonymised_at: Date | null;
}

export async function loadContactRetention(db: Db, contactId: string): Promise<ContactRetention | null> {
  const rows = await db.$queryRaw<RetentionRow[]>`
    SELECT to_char(contact_retention_until(c."id"), 'YYYY-MM-DD') AS retain_until,
           contact_has_open_documents(c."id")                     AS open_documents,
           to_char(business_today(), 'YYYY-MM-DD')                AS today,
           c."anonymisedAt"                                       AS anonymised_at
      FROM "contacts" c WHERE c."id" = ${contactId}`;
  const row = rows[0];
  if (!row) return null;
  return {
    anonymisedAt: row.anonymised_at ? row.anonymised_at.toISOString() : null,
    retainUntil: row.retain_until,
    hasOpenDocuments: row.open_documents,
    verdict: retentionVerdict({
      anonymisedAt: row.anonymised_at,
      hasOpenDocuments: row.open_documents,
      retainUntil: row.retain_until,
      today: row.today,
    }),
  };
}

const REFUSALS: Record<string, { code: string; status: number; message: (m: string) => string }> = {
  CONTACT_NOT_FOUND: { code: "NOT_FOUND", status: 404, message: () => "Contact not found" },
  CONTACT_ANONYMISED: { code: "ALREADY_ANONYMISED", status: 409, message: () => "This contact has already been anonymised" },
  CONTACT_OPEN_DOCUMENTS: {
    code: "OPEN_DOCUMENTS",
    status: 409,
    message: () => "This contact still has draft, unpaid or part-paid documents. Finish or void them first",
  },
  CONTACT_RETENTION: {
    code: "WITHIN_RETENTION",
    status: 409,
    message: (m) => {
      const day = /(\d{4}-\d{2}-\d{2})/.exec(m)?.[1];
      return `Its documents must be kept until ${day ?? "the end of the retention period"}`;
    },
  },
};

/** The text a Postgres exception carries, wherever Prisma put it. */
function databaseMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { message?: unknown } | undefined;
    return `${typeof meta?.message === "string" ? meta.message : ""} ${error.message}`;
  }
  return error instanceof Error ? error.message : "";
}

/**
 * Removes a contact's personal details, and the customer snapshot on its
 * documents. Must run in the caller's transaction so the audit row commits
 * with it. The audit row records that it happened and why, never what was removed.
 */
export async function anonymiseContact(
  tx: Prisma.TransactionClient,
  input: { contactId: string; reason: string; actor: AuditActor; ipAddress: string | null }
): Promise<void> {
  try {
    await tx.$executeRaw`SELECT anonymise_contact(${input.contactId})`;
  } catch (error) {
    const text = databaseMessage(error);
    const known = Object.keys(REFUSALS).find((key) => text.includes(key));
    if (known) throw new AccountingError(REFUSALS[known].code, REFUSALS[known].message(text), REFUSALS[known].status);
    throw error;
  }
  await recordAudit(tx, {
    actor: input.actor,
    action: "contact.anonymise",
    entityType: "Contact",
    entityId: input.contactId,
    after: { anonymised: true },
    reason: input.reason,
    ipAddress: input.ipAddress,
  });
}

/** Columns that identify staff or internal rows rather than the person the export is about. */
const INTERNAL_KEY = /(?:ById|^journalEntryId|^bankAccountId)$/;

function stripInternal(value: unknown): unknown {
  const json = toAuditJson(value);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).filter(([k]) => !INTERNAL_KEY.test(k)).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(json);
}

/**
 * Everything held about one contact, for a subject access request: the contact
 * record, its invoices (with lines), credit notes, payments, and what the audit
 * log says about the contact. Staff identifiers and hash-chain internals are
 * left out — they describe our people and our log, not the subject.
 */
export async function exportContactData(db: Db, contactId: string) {
  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new AccountingError("NOT_FOUND", "Contact not found", 404);

  const [invoices, creditNotes, payments, audit] = await Promise.all([
    db.invoice.findMany({ where: { contactId }, include: { lines: true }, orderBy: { issueDate: "asc" } }),
    db.creditNote.findMany({ where: { contactId }, include: { lines: true }, orderBy: { issueDate: "asc" } }),
    db.customerPayment.findMany({ where: { contactId }, orderBy: { date: "asc" } }),
    db.auditLog.findMany({
      where: { entityType: "Contact", entityId: contactId },
      select: { occurredAt: true, action: true, before: true, after: true, reason: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  return {
    format: "smartvie-contact-export/1",
    generatedAt: new Date().toISOString(),
    contact: stripInternal(contact),
    invoices: stripInternal(invoices),
    creditNotes: stripInternal(creditNotes),
    payments: stripInternal(payments),
    auditTrail: toAuditJson(audit),
  };
}
