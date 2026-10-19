import type { Prisma } from "@prisma/client";

/**
 * Whether a company-settings update changes the bank details printed on every
 * invoice. Swapping those is the classic invoice-fraud move (customers pay the
 * fraudster), so it is a step-up action; editing the company's address or
 * invoice prefix is not.
 *
 * Only fields present in the update count (an absent key leaves the column
 * alone), and "" and null are the same "no value".
 */
const BANK_FIELDS = ["bankAccountName", "bankSortCode", "bankAccountNumber"] as const;

type BankFields = Partial<Record<(typeof BANK_FIELDS)[number], string | null | undefined>>;

const norm = (value: string | null | undefined) => (value ?? "").trim();

export function bankDetailsChanged(existing: BankFields | null, incoming: BankFields): boolean {
  return BANK_FIELDS.some((field) => incoming[field] !== undefined && norm(incoming[field]) !== norm(existing?.[field]));
}

/** How many invoice approvals show the warning after a change. */
export const BANK_CHANGE_NOTICE_APPROVALS = 3;
const SETTINGS_ID = "default";

export interface BankChangeNotice {
  changedAt: string;
  changedBy: string | null;
}

/** The warning to show on an approval, or null once enough invoices have been approved since. */
export function bankChangeNotice(
  changedAt: Date | null | undefined,
  changedBy: string | null | undefined,
  approvalsSince: number
): BankChangeNotice | null {
  if (!changedAt || approvalsSince >= BANK_CHANGE_NOTICE_APPROVALS) return null;
  return { changedAt: changedAt.toISOString(), changedBy: changedBy ?? null };
}

type Tx = Pick<Prisma.TransactionClient, "companySettings" | "invoice">;

/** Records that the payee details just changed (inside the change's transaction). */
export async function markBankDetailsChanged(tx: Pick<Prisma.TransactionClient, "companySettings">, by: string | null) {
  const data = { bankDetailsChangedAt: new Date(), bankDetailsChangedBy: by };
  await tx.companySettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
}

export async function loadBankChangeNotice(db: Tx): Promise<BankChangeNotice | null> {
  const settings = await db.companySettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { bankDetailsChangedAt: true, bankDetailsChangedBy: true },
  });
  if (!settings?.bankDetailsChangedAt) return null;
  const approvalsSince = await db.invoice.count({
    where: { approvedAt: { gte: settings.bankDetailsChangedAt } },
  });
  return bankChangeNotice(settings.bankDetailsChangedAt, settings.bankDetailsChangedBy, approvalsSince);
}
