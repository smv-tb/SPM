import { createHash } from "node:crypto";

/**
 * Retention and privacy rules for contacts (S3.6). Pure — no database, no Prisma.
 *
 * The authority is the database: `contact_retention_until()` and
 * `anonymise_contact()` (migration `_contact_anonymisation`) decide what may be
 * scrubbed, so a script or psql session is held to the same rule. This module
 * mirrors the date arithmetic so the screens can say *when* something becomes
 * eligible; prisma/checks/contact-anonymisation.sql and the unit tests pin the
 * two to the same answers.
 */

/** Company records are kept for six years after the end of the financial year they belong to. */
export const RETENTION_YEARS = 6;

/** What an anonymised contact and its documents are called. */
export const ANONYMISED_NAME = "Anonymised contact";

/**
 * The last day records about a contact must be kept: six years after the end of
 * the financial year of its most recent document. `null` when it has none.
 * Financial years run from `startMonth`/`startDay`; dates are calendar days (UTC).
 */
export function retentionUntil(latestDocument: Date | null, startMonth: number, startDay: number): Date | null {
  if (!latestDocument) return null;
  let startYear = latestDocument.getUTCFullYear();
  const thisYearStart = Date.UTC(startYear, startMonth - 1, startDay);
  const day = Date.UTC(latestDocument.getUTCFullYear(), latestDocument.getUTCMonth(), latestDocument.getUTCDate());
  if (day < thisYearStart) startYear -= 1;
  // The day before next year starts is this year's last day.
  const yearEnd = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay - 1));
  return new Date(Date.UTC(yearEnd.getUTCFullYear() + RETENTION_YEARS, yearEnd.getUTCMonth(), yearEnd.getUTCDate()));
}

export type RetentionVerdict =
  | { canAnonymise: true; reason: null }
  | { canAnonymise: false; reason: "ALREADY_ANONYMISED" | "OPEN_DOCUMENTS" | "WITHIN_RETENTION"; until?: string };

/** Whether a contact may be anonymised today. `today` is the business day as `YYYY-MM-DD`. */
export function retentionVerdict(input: {
  anonymisedAt: Date | null;
  hasOpenDocuments: boolean;
  retainUntil: string | null;
  today: string;
}): RetentionVerdict {
  if (input.anonymisedAt) return { canAnonymise: false, reason: "ALREADY_ANONYMISED" };
  if (input.hasOpenDocuments) return { canAnonymise: false, reason: "OPEN_DOCUMENTS" };
  if (input.retainUntil !== null && input.retainUntil >= input.today) {
    return { canAnonymise: false, reason: "WITHIN_RETENTION", until: input.retainUntil };
  }
  return { canAnonymise: true, reason: null };
}

const PERSONAL_FIELDS = ["email", "phone", "taxId", "billingAddress", "shippingAddress", "notes"] as const;

/** A short, one-way marker so an audit row can show *that* a value changed without holding it. */
function marker(value: string): string {
  return `on file #${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

/**
 * A contact as it goes into the audit log. The log can never be edited or
 * pruned, so it must not hold personal details that would then outlive the
 * retention period: name and commercial terms are recorded as they are; email,
 * phone, tax id, addresses and notes only as a marker that changes when the
 * value does.
 */
export function auditableContact<T extends Record<string, unknown>>(contact: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...contact };
  for (const field of PERSONAL_FIELDS) {
    const value = out[field];
    out[field] = typeof value === "string" && value.length > 0 ? marker(value) : null;
  }
  return out;
}
