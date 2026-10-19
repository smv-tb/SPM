/**
 * Aged debtors as a pure calculation: what each customer owes as at a date,
 * split by how late it is. The query that feeds it lives in
 * aged-debtors-query.ts; this file decides the buckets and the totals.
 */

import { sumPence, type Pence } from "@/lib/money";
import { ledgerDateKey } from "./dates";

export const AGE_BUCKETS = ["current", "days1to30", "days31to60", "days61to90", "over90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const AGE_BUCKET_LABEL: Record<AgeBucket, string> = {
  current: "Not yet due",
  days1to30: "1–30 days",
  days31to60: "31–60 days",
  days61to90: "61–90 days",
  over90: "Over 90 days",
};

const DAY_MS = 86_400_000;

/** Whole days between two calendar days; ledger dates are UTC midnights. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((Date.parse(ledgerDateKey(to)) - Date.parse(ledgerDateKey(from))) / DAY_MS);
}

/** Late by days past the due date; due today is not yet late. */
export function bucketFor(dueDate: Date, asAt: Date): AgeBucket {
  const late = daysBetween(dueDate, asAt);
  if (late <= 0) return "current";
  if (late <= 30) return "days1to30";
  if (late <= 60) return "days31to60";
  if (late <= 90) return "days61to90";
  return "over90";
}

export interface OpenInvoice {
  id: string;
  number: string | null;
  contactId: string;
  contactName: string;
  dueDate: Date;
  /** What is still owed on it as at the report date. */
  outstanding: Pence;
}

export interface UnusedCredit {
  contactId: string;
  contactName: string;
  /** Credit not yet applied or refunded as at the report date (positive). */
  amount: Pence;
}

export type AgedRow = Record<AgeBucket, Pence> & {
  contactId: string;
  contactName: string;
  /** Shown as a reduction: overpayments and unallocated credit notes. */
  unusedCredit: Pence;
  /** Owed minus unused credit; negative when the customer is in credit. */
  balance: Pence;
  invoices: { id: string; number: string | null; dueDate: string; bucket: AgeBucket; outstanding: Pence }[];
};

export interface AgedDebtors {
  asAt: string;
  rows: AgedRow[];
  totals: Record<AgeBucket, Pence> & { unusedCredit: Pence; balance: Pence };
}

export function buildAgedDebtors(asAt: Date, invoices: OpenInvoice[], credits: UnusedCredit[]): AgedDebtors {
  const rows = new Map<string, AgedRow>();
  const rowFor = (contactId: string, contactName: string): AgedRow => {
    let row = rows.get(contactId);
    if (!row) {
      row = {
        contactId,
        contactName,
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        over90: 0,
        unusedCredit: 0,
        balance: 0,
        invoices: [],
      };
      rows.set(contactId, row);
    }
    return row;
  };

  for (const invoice of invoices) {
    if (invoice.outstanding <= 0) continue;
    const row = rowFor(invoice.contactId, invoice.contactName);
    const bucket = bucketFor(invoice.dueDate, asAt);
    row[bucket] += invoice.outstanding;
    row.invoices.push({
      id: invoice.id,
      number: invoice.number,
      dueDate: ledgerDateKey(invoice.dueDate),
      bucket,
      outstanding: invoice.outstanding,
    });
  }
  for (const credit of credits) {
    if (credit.amount <= 0) continue;
    rowFor(credit.contactId, credit.contactName).unusedCredit += credit.amount;
  }

  const list = [...rows.values()]
    .map((row) => ({
      ...row,
      balance: sumPence(AGE_BUCKETS.map((b) => row[b])) - row.unusedCredit,
      invoices: row.invoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    }))
    // Biggest debts first: the order someone chasing payment wants.
    .sort((a, b) => b.balance - a.balance || a.contactName.localeCompare(b.contactName));

  const total = (key: AgeBucket | "unusedCredit" | "balance") => sumPence(list.map((r) => r[key]));
  return {
    asAt: ledgerDateKey(asAt),
    rows: list,
    totals: {
      current: total("current"),
      days1to30: total("days1to30"),
      days31to60: total("days31to60"),
      days61to90: total("days61to90"),
      over90: total("over90"),
      unusedCredit: total("unusedCredit"),
      balance: total("balance"),
    },
  };
}
