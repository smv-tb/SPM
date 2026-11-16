/**
 * Suggesting what each bank statement line is, as pure functions.
 *
 * A statement line can be:
 *  - BOOK: an entry already in the books on that bank account (a recorded
 *    payment, a refund, a transfer) — same amount, close in date;
 *  - INVOICE: money in that pays one or more open invoices not yet recorded
 *    as paid — matching it records the payment and reconciles in one step;
 *  - BILL: the same for money out that pays one or more open supplier bills;
 *  - CREATE: nothing in the books yet, but lines described like this one were
 *    posted straight to an account before (bank charges, a subscription) —
 *    matching posts the journal and reconciles in one step.
 *
 * The engine learns from what was reconciled earlier (`Learning`): which
 * account lines with this description were posted to, and which customer or
 * supplier they turned out to be. Nothing is stored for that — it is read
 * from the reconciliations themselves, so unmatching a mistake unlearns it.
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

export interface OpenBillIn {
  id: string;
  /** The supplier's invoice number, when the bill has one. */
  reference: string | null;
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
    }
  | {
      kind: "BILL";
      billIds: string[];
      contactId: string;
      label: string;
      confidence: Confidence;
      score: number;
      reasons: string[];
    }
  | {
      /** Post the line straight to an account, as was done before. */
      kind: "CREATE";
      accountId: string;
      label: string;
      /** How many of the recent lines like this one went to that account. */
      uses: number;
      confidence: Confidence;
      score: number;
      reasons: string[];
    };

/** A statement line reconciled earlier, and what it turned out to be. */
export type PastMatch = {
  description: string;
  /** Signed, as on the statement: money in positive. */
  amount: Pence;
} & (
  | { kind: "ACCOUNT"; accountId: string } // posted straight to this account
  | { kind: "CONTACT"; contactId: string } // a payment from or to this contact
);

export interface Learning {
  /** Most recent first. */
  past: PastMatch[];
  /** The accounts a line may be posted to today. A habit of posting anywhere else is not offered. */
  accounts: { id: string; label: string }[];
}

/** A habit is trusted without a person once it has been followed this many times… */
export const LEARN_MIN_USES = 2;
/** …with no exception among this many of the most recent lines like it. */
export const LEARN_LOOKBACK = 5;

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
 * What a description says once the parts that change every time are gone:
 * "DD GOOGLE WORKSPACE 39281 12NOV" and next month's are the same key. Words
 * carrying digits (references, dates, card numbers) are dropped. Empty when
 * nothing distinctive is left — such a line teaches nothing.
 */
export function descriptionKey(description: string): string {
  return significantWords(description)
    .filter((w) => !/\d/.test(w))
    .sort()
    .join(" ");
}

/** Money in and money out under one description are different habits. */
function habitKey(description: string, amount: Pence): string | null {
  const key = descriptionKey(description);
  return key && amount !== 0 ? `${amount > 0 ? "IN" : "OUT"}:${key}` : null;
}

/** The most recent lines like each description, newest first. */
function recentByHabit(past: PastMatch[]): Map<string, PastMatch[]> {
  const index = new Map<string, PastMatch[]>();
  for (const match of past) {
    const key = habitKey(match.description, match.amount);
    if (!key) continue;
    const list = index.get(key) ?? [];
    if (list.length < LEARN_LOOKBACK) list.push(match);
    index.set(key, list);
  }
  return index;
}

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** The customer or supplier every recent line like this one turned out to be. */
function learnedContact(recent: PastMatch[]): { contactId: string; uses: number } | null {
  const [first] = recent;
  if (!first || first.kind !== "CONTACT") return null;
  const same = recent.every((m) => m.kind === "CONTACT" && m.contactId === first.contactId);
  return same ? { contactId: first.contactId, uses: recent.length } : null;
}

/**
 * Lines like this one were posted straight to an account before. Sure only
 * when it has happened at least twice and never differently among the recent
 * ones; a habit that changed is shown, newest choice first, for a person.
 */
function createCandidates(recent: PastMatch[], accounts: Map<string, string>): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const match of recent) {
    if (match.kind !== "ACCOUNT" || seen.has(match.accountId)) continue;
    seen.add(match.accountId);
    const label = accounts.get(match.accountId);
    if (!label) continue;
    const uses = recent.filter((m) => m.kind === "ACCOUNT" && m.accountId === match.accountId).length;
    const always = uses === recent.length;
    out.push({
      kind: "CREATE",
      accountId: match.accountId,
      label: `Post to ${label}`,
      uses,
      confidence: always && uses >= LEARN_MIN_USES ? "HIGH" : match === recent[0] ? "MEDIUM" : "LOW",
      score: 20 + uses * 5,
      reasons: [
        always
          ? uses === 1
            ? "Posted there the last time a line like this appeared"
            : `Posted there the last ${uses} times a line like this appeared`
          : `Posted there ${uses} of the last ${recent.length} times a line like this appeared`,
      ],
    });
  }
  return out;
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

/** Subsets of up to four documents that sum exactly to the amount. */
function exactCombinations<T extends { amountDue: Pence }>(documents: T[], amount: Pence): T[][] {
  const found: T[][] = [];
  const list = documents.slice(0, 12); // a bounded search: 12 choose ≤4 is small
  const walk = (start: number, chosen: T[], total: Pence) => {
    if (total === amount && chosen.length >= 2) found.push(chosen);
    if (chosen.length === 4 || total >= amount) return;
    for (let i = start; i < list.length; i++) walk(i + 1, [...chosen, list[i]], total + list[i].amountDue);
  };
  walk(0, [], 0);
  return found;
}

/** Why a combination is this contact's: the bank names them, or earlier matches do. */
const who = (line: StatementLineIn, name: string) =>
  namesCustomer(line.description, name) ? `Names ${name}` : `Lines like this were ${name} before`;

type Known = { contactId: string; uses: number } | null;

function invoiceCandidates(line: StatementLineIn, invoices: OpenInvoiceIn[], known: Known): Candidate[] {
  if (line.amount <= 0) return [];
  const open = invoices.filter((i) => i.amountDue > 0 && i.issueDate <= line.date);
  const out: Candidate[] = [];

  for (const invoice of open) {
    const quoted = quotesInvoice(line.description, invoice.number);
    const named = namesCustomer(line.description, invoice.contactName);
    const learned = known?.contactId === invoice.contactId ? known.uses : 0;
    const exact = invoice.amountDue === line.amount;
    if (!exact && !quoted) continue;
    const reasons: string[] = [];
    if (exact) reasons.push("Pays exactly what is due");
    if (quoted) reasons.push(`Quotes ${invoice.number}`);
    if (named) reasons.push(`Names ${invoice.contactName}`);
    if (learned) reasons.push(`Lines like this were ${invoice.contactName} ${times(learned)} before`);
    // A quoted number with a different amount is a part payment or an
    // overpayment: worth showing, never automatic. A payer recognised from
    // earlier matches is as good as a quoted number once it has held twice.
    const confidence: Confidence =
      exact && (quoted || learned >= LEARN_MIN_USES) ? "HIGH" : exact && (named || learned) ? "MEDIUM" : "LOW";
    out.push({
      kind: "INVOICE",
      invoiceIds: [invoice.id],
      contactId: invoice.contactId,
      label: `Payment for ${invoice.number} — ${invoice.contactName}`,
      confidence,
      score: (exact ? 50 : 0) + (quoted ? 40 : 0) + (named ? 20 : 0) + (learned ? 20 : 0),
      reasons,
    });
  }

  // One transfer paying several invoices of one customer the bank names, or
  // that lines like this one were matched to before.
  const byCustomer = new Map<string, OpenInvoiceIn[]>();
  for (const invoice of open) {
    if (!namesCustomer(line.description, invoice.contactName) && known?.contactId !== invoice.contactId) continue;
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
        reasons: ["Pays exactly what is due on all of them", who(line, combo[0].contactName), ...(allQuoted ? ["Quotes every number"] : [])],
      });
    }
  }
  return out;
}

/**
 * Does the description quote the supplier's reference? Their numbering is
 * theirs, so a reference too short to be distinctive ("12") is not evidence.
 */
export function quotesReference(description: string, reference: string | null): boolean {
  if (!reference || reference.replace(/[^A-Za-z0-9]/g, "").length < 4) return false;
  return quotesInvoice(description, reference);
}

const billName = (bill: OpenBillIn) => bill.reference ?? `bill of ${bill.issueDate}`;

/** Money out that pays supplier bills: the same evidence as invoices, mirrored. */
function billCandidates(line: StatementLineIn, bills: OpenBillIn[], known: Known): Candidate[] {
  if (line.amount >= 0) return [];
  const paid = -line.amount;
  const open = bills.filter((b) => b.amountDue > 0 && b.issueDate <= line.date);
  const out: Candidate[] = [];

  for (const bill of open) {
    const quoted = quotesReference(line.description, bill.reference);
    const named = namesCustomer(line.description, bill.contactName);
    const learned = known?.contactId === bill.contactId ? known.uses : 0;
    const exact = bill.amountDue === paid;
    if (!exact && !quoted) continue;
    const reasons: string[] = [];
    if (exact) reasons.push("Pays exactly what is due");
    if (quoted) reasons.push(`Quotes ${bill.reference}`);
    if (named) reasons.push(`Names ${bill.contactName}`);
    if (learned) reasons.push(`Lines like this were ${bill.contactName} ${times(learned)} before`);
    const confidence: Confidence =
      exact && (quoted || learned >= LEARN_MIN_USES) ? "HIGH" : exact && (named || learned) ? "MEDIUM" : "LOW";
    out.push({
      kind: "BILL",
      billIds: [bill.id],
      contactId: bill.contactId,
      label: `Pays ${billName(bill)} — ${bill.contactName}`,
      confidence,
      score: (exact ? 50 : 0) + (quoted ? 40 : 0) + (named ? 20 : 0) + (learned ? 20 : 0),
      reasons,
    });
  }

  // One transfer paying several bills of one supplier the bank names, or
  // that lines like this one were matched to before.
  const bySupplier = new Map<string, OpenBillIn[]>();
  for (const bill of open) {
    if (!namesCustomer(line.description, bill.contactName) && known?.contactId !== bill.contactId) continue;
    bySupplier.set(bill.contactId, [...(bySupplier.get(bill.contactId) ?? []), bill]);
  }
  for (const [contactId, theirs] of bySupplier) {
    for (const combo of exactCombinations(theirs, paid)) {
      const allQuoted = combo.every((b) => quotesReference(line.description, b.reference));
      out.push({
        kind: "BILL",
        billIds: combo.map((b) => b.id),
        contactId,
        label: `Pays ${combo.map(billName).join(" + ")} — ${combo[0].contactName}`,
        confidence: allQuoted ? "HIGH" : "MEDIUM",
        score: 45 + (allQuoted ? 40 : 0),
        reasons: ["Pays exactly what is due on all of them", who(line, combo[0].contactName), ...(allQuoted ? ["Quotes every reference"] : [])],
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
 *
 * A learned posting (CREATE) puts new money in the books, so it is only safe
 * when nothing else could be this line: with any book entry, invoice or bill
 * in the running it is shown, never applied — posting it too would count the
 * money twice.
 */
export function suggestMatches(
  lines: StatementLineIn[],
  books: BookLineIn[],
  invoices: OpenInvoiceIn[],
  bills: OpenBillIn[] = [],
  learning: Learning = { past: [], accounts: [] }
): Suggestion[] {
  const habits = recentByHabit(learning.past);
  const accounts = new Map(learning.accounts.map((a) => [a.id, a.label]));
  const raw = lines.map((line) => {
    const recent = habits.get(habitKey(line.description, line.amount) ?? "") ?? [];
    const known = learnedContact(recent);
    const existing = [
      ...bookCandidates(line, books),
      ...invoiceCandidates(line, invoices, known),
      ...billCandidates(line, bills, known),
    ];
    const learned = createCandidates(recent, accounts);
    if (existing.length > 0) {
      for (const c of learned) {
        if (c.confidence !== "HIGH") continue;
        c.confidence = "MEDIUM";
        c.reasons.push("Check the other matches first: one of them may already be this money");
      }
    }
    return { line, existing, candidates: [...existing, ...learned] };
  });

  // Which lines each book entry could be: an entry wanted by two lines is
  // ambiguous for both.
  const wantedBy = new Map<string, number>();
  for (const { candidates } of raw) {
    for (const c of candidates) {
      for (const key of keysOf(c)) wantedBy.set(key, (wantedBy.get(key) ?? 0) + 1);
    }
  }
  for (const { existing } of raw) {
    const [only] = existing;
    if (
      existing.length === 1 &&
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
  if (c.kind === "CREATE") return []; // claims nothing that already exists
  if (c.kind === "BOOK") return c.journalLineIds.map((id) => `book:${id}`);
  if (c.kind === "BILL") return c.billIds.map((id) => `bill:${id}`);
  return c.invoiceIds.map((id) => `inv:${id}`);
}
