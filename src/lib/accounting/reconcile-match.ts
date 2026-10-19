/**
 * Suggesting what each bank statement line is, as pure functions.
 *
 * A statement line can be:
 *  - BOOK: an entry already in the books on that bank account (a recorded
 *    payment, a refund, a transfer) — same amount, close in date;
 *  - INVOICE: money in that pays one or more open invoices not yet recorded
 *    as paid — matching it records the payment and reconciles in one step.
 *
 * Every candidate gets a confidence. Only HIGH is ever applied without a
 * person looking, and only when nothing competes for the same line or the
 * same book entry/invoice: auto-reconcile is for the obvious, and anything
 * arguable is shown as a suggestion.
 */

import type { Pence } from "@/lib/money";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface StatementLineIn {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Signed: money in positive. */
  amount: Pence;
  description: string;
}

export interface BookLineIn {
  journalLineId: string;
  date: string;
  /** Debit minus credit on the bank account: money in positive. */
  amount: Pence;
  /** What the entry says about itself: memo, reference, line description. */
  text: string;
  /** "Payment from Acme Frank", for display. */
  label: string;
}

export interface OpenInvoiceIn {
  id: string;
  number: string;
  contactId: string;
  contactName: string;
  amountDue: Pence;
  issueDate: string;
}

export type Candidate =
  | {
      kind: "BOOK";
      journalLineIds: string[];
      label: string;
      date: string;
      /** Days between the books' date and the bank's. */
      days: number;
      confidence: Confidence;
      score: number;
      reasons: string[];
    }
  | {
      kind: "INVOICE";
      invoiceIds: string[];
      contactId: string;
      label: string;
      confidence: Confidence;
      score: number;
      reasons: string[];
    };

export interface Suggestion {
  statementLineId: string;
  candidates: Candidate[];
  /** The best candidate, when it is safe to apply without asking. */
  auto: Candidate | null;
}

/** How far apart the bank's date and the books' date may be. */
export const DATE_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;
export const daysApart = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS);

/** Words that say nothing about who someone is. */
const NOISE = new Set([
  "LTD", "LIMITED", "PLC", "LLP", "THE", "AND", "CO", "COMPANY", "UK", "GROUP", "SERVICES", "SERVICE",
  "PAYMENT", "PAYMENTS", "FROM", "TO", "REF", "INV", "INVOICE", "BANK", "TRANSFER", "FPI", "FPO", "BGC",
]);

export function significantWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toUpperCase()
        .replace(/&/g, " ")
        .split(/[^A-Z0-9]+/)
        .filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w))
    ),
  ];
}

/**
 * Does the bank's description name this customer? Every significant word of
 * a short name must appear (ACME + FRANK), or at least two of a long one —
 * a single shared word like "SMART" is not evidence.
 */
export function namesCustomer(description: string, name: string): boolean {
  const words = significantWords(name);
  if (words.length === 0) return false;
  const haystack = new Set(significantWords(description));
  const found = words.filter((w) => haystack.has(w)).length;
  return words.length <= 2 ? found === words.length : found >= 2;
}

/**
 * Does the description quote this invoice number? "INV001" is found as
 * INV001, INV 001, INV-1 or INV1 — never as part of INV0012.
 */
export function quotesInvoice(description: string, number: string): boolean {
  const match = /^([A-Z-]*?)-?0*(\d+)$/.exec(number.toUpperCase());
  if (!match) return description.toUpperCase().includes(number.toUpperCase());
  const [, prefix, digits] = match;
  const escaped = prefix.replace(/-/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9])${escaped}[\\s-]*0*${digits}(?!\\d)`).test(description.toUpperCase());
}

/** Shared significant words between the books' text and the bank's. */
function textOverlap(a: string, b: string): number {
  const words = new Set(significantWords(b));
  return significantWords(a).filter((w) => words.has(w)).length;
}

function bookCandidates(line: StatementLineIn, books: BookLineIn[]): Candidate[] {
  return books
    .filter((b) => b.amount === line.amount && daysApart(b.date, line.date) <= DATE_WINDOW_DAYS)
    .map((b) => {
      const days = daysApart(b.date, line.date);
      const overlap = textOverlap(b.text, line.description);
      const reasons = ["Same amount", days === 0 ? "Same day" : `${days} day${days === 1 ? "" : "s"} apart`];
      if (overlap > 0) reasons.push("Description matches");
      return {
        kind: "BOOK" as const,
        journalLineIds: [b.journalLineId],
        label: b.label,
        date: b.date,
        days,
        score: 60 - days * 3 + Math.min(overlap, 3) * 10,
        // Close and corroborated, or close and alone (decided later).
        confidence: (days <= 5 && overlap > 0 ? "HIGH" : "MEDIUM") as Confidence,
        reasons,
      };
    });
}

/** Subsets of up to four invoices that sum exactly to the amount. */
function exactCombinations(invoices: OpenInvoiceIn[], amount: Pence): OpenInvoiceIn[][] {
  const found: OpenInvoiceIn[][] = [];
  const list = invoices.slice(0, 12); // a bounded search: 12 choose ≤4 is small
  const walk = (start: number, chosen: OpenInvoiceIn[], total: Pence) => {
    if (total === amount && chosen.length >= 2) found.push(chosen);
    if (chosen.length === 4 || total >= amount) return;
    for (let i = start; i < list.length; i++) walk(i + 1, [...chosen, list[i]], total + list[i].amountDue);
  };
  walk(0, [], 0);
  return found;
}

function invoiceCandidates(line: StatementLineIn, invoices: OpenInvoiceIn[]): Candidate[] {
  if (line.amount <= 0) return [];
  const open = invoices.filter((i) => i.amountDue > 0 && i.issueDate <= line.date);
  const out: Candidate[] = [];

  for (const invoice of open) {
    const quoted = quotesInvoice(line.description, invoice.number);
    const named = namesCustomer(line.description, invoice.contactName);
    const exact = invoice.amountDue === line.amount;
    if (!exact && !quoted) continue;
    const reasons: string[] = [];
    if (exact) reasons.push("Pays exactly what is due");
    if (quoted) reasons.push(`Quotes ${invoice.number}`);
    if (named) reasons.push(`Names ${invoice.contactName}`);
    // A quoted number with a different amount is a part payment or an
    // overpayment: worth showing, never automatic.
    const confidence: Confidence = exact && quoted ? "HIGH" : exact && named ? "MEDIUM" : "LOW";
    out.push({
      kind: "INVOICE",
      invoiceIds: [invoice.id],
      contactId: invoice.contactId,
      label: `Payment for ${invoice.number} — ${invoice.contactName}`,
      confidence,
      score: (exact ? 50 : 0) + (quoted ? 40 : 0) + (named ? 20 : 0),
      reasons,
    });
  }

  // One transfer paying several invoices of one customer the bank names.
  const byCustomer = new Map<string, OpenInvoiceIn[]>();
  for (const invoice of open) {
    if (!namesCustomer(line.description, invoice.contactName)) continue;
    byCustomer.set(invoice.contactId, [...(byCustomer.get(invoice.contactId) ?? []), invoice]);
  }
  for (const [contactId, theirs] of byCustomer) {
    for (const combo of exactCombinations(theirs, line.amount)) {
      const allQuoted = combo.every((i) => quotesInvoice(line.description, i.number));
      out.push({
        kind: "INVOICE",
        invoiceIds: combo.map((i) => i.id),
        contactId,
        label: `Payment for ${combo.map((i) => i.number).join(" + ")} — ${combo[0].contactName}`,
        confidence: allQuoted ? "HIGH" : "MEDIUM",
        score: 45 + (allQuoted ? 40 : 0),
        reasons: ["Pays exactly what is due on all of them", `Names ${combo[0].contactName}`, ...(allQuoted ? ["Quotes every number"] : [])],
      });
    }
  }
  return out;
}

const RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * Suggestions for every statement line, then the safe-to-apply ones: a HIGH
 * candidate that is the line's only HIGH one, whose book entries or invoices
 * no other line's HIGH candidate wants. A book entry that is the line's only
 * candidate and wants no other line is promoted to HIGH when the dates are
 * close: the same amount, alone, within a few days.
 */
export function suggestMatches(
  lines: StatementLineIn[],
  books: BookLineIn[],
  invoices: OpenInvoiceIn[]
): Suggestion[] {
  const raw = lines.map((line) => ({
    line,
    candidates: [...bookCandidates(line, books), ...invoiceCandidates(line, invoices)],
  }));

  // Which lines each book entry could be: an entry wanted by two lines is
  // ambiguous for both.
  const wantedBy = new Map<string, number>();
  for (const { candidates } of raw) {
    for (const c of candidates) {
      for (const key of keysOf(c)) wantedBy.set(key, (wantedBy.get(key) ?? 0) + 1);
    }
  }
  for (const { candidates } of raw) {
    const [only] = candidates;
    if (
      candidates.length === 1 &&
      only.kind === "BOOK" &&
      only.confidence !== "HIGH" &&
      only.days <= 5 &&
      wantedBy.get(keysOf(only)[0]) === 1
    ) {
      only.confidence = "HIGH";
      only.reasons.push("The only entry that fits");
    }
  }

  const highClaims = new Map<string, number>();
  for (const { candidates } of raw) {
    for (const c of candidates.filter((c) => c.confidence === "HIGH")) {
      for (const key of keysOf(c)) highClaims.set(key, (highClaims.get(key) ?? 0) + 1);
    }
  }

  return raw.map(({ line, candidates }) => {
    const sorted = [...candidates].sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.score - a.score);
    const highs = sorted.filter((c) => c.confidence === "HIGH");
    const auto =
      highs.length === 1 && keysOf(highs[0]).every((key) => highClaims.get(key) === 1) ? highs[0] : null;
    return { statementLineId: line.id, candidates: sorted, auto };
  });
}

function keysOf(c: Candidate): string[] {
  return c.kind === "BOOK" ? c.journalLineIds.map((id) => `book:${id}`) : c.invoiceIds.map((id) => `inv:${id}`);
}
