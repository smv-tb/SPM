import { Prisma } from "@prisma/client";
import { formatPence, fromPence, sumPence, toPence, type Pence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { SYSTEM_ACCOUNT_CODES } from "./chart";
import { ledgerDateKey } from "./dates";
import { AccountingError } from "./errors";
import { userId } from "./invoices";
import { recordReceipt } from "./payments";
import { postNewJournal } from "./posting";
import {
  suggestMatches,
  type BookLineIn,
  type Candidate,
  type OpenInvoiceIn,
  type StatementLineIn,
  type Suggestion,
} from "./reconcile-match";
import { settledByInvoice } from "./settlement";

/**
 * The only code that reconciles: links bank statement lines to the posted
 * journal lines on that bank's ledger account that are the same money. A
 * reconciliation changes nothing in the ledger — but matching a line to an
 * open invoice records the payment first, and "create" posts the journal
 * the line needs, so those two go through the posting and payment services
 * in the same transaction.
 */

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "bankAccount" | "statementLine" | "journalLine" | "invoice" | "creditAllocation" | "paymentAllocation">;

async function loadAccount(db: Pick<Tx, "bankAccount">, bankAccountId: string) {
  const account = await db.bankAccount.findUnique({
    where: { id: bankAccountId },
    include: { ledgerAccount: true },
  });
  if (!account) throw new AccountingError("NOT_FOUND", "Bank account not found", 404);
  return account;
}

/**
 * Posted lines on the bank's ledger account not yet matched to the statement.
 * A journal and its reversal cancel out (a voided payment), so neither is
 * offered: the bank never saw that money move.
 */
export async function unreconciledBookLines(db: Pick<Tx, "journalLine">, ledgerAccountId: string) {
  return db.journalLine.findMany({
    where: {
      accountId: ledgerAccountId,
      reconciled: null,
      entry: { status: "POSTED", reversesId: null, reversedBy: null },
    },
    include: { entry: { select: { id: true, number: true, date: true, memo: true, reference: true } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
  });
}

export interface ReconcileView {
  lines: (StatementLineIn & { type: string | null; balance: Pence | null })[];
  suggestions: Suggestion[];
  /** Invoices still owed, so money in can be tagged to them by hand. Oldest first. */
  openInvoices: { id: string; number: string; contactId: string; contactName: string; amountDue: Pence; issueDate: string }[];
  /** In the books on this account but not (yet) on the statement. */
  bookOnly: { journalLineId: string; entryId: string; journalNumber: number | null; date: string; amount: Pence; label: string }[];
}

/** Everything the reconcile screen needs: lines, suggestions and loose book entries. */
export async function reconcileView(db: Reader, bankAccountId: string): Promise<ReconcileView> {
  const account = await loadAccount(db, bankAccountId);
  const [statement, book, invoices] = await Promise.all([
    db.statementLine.findMany({
      where: { bankAccountId, reconciledAt: null },
      orderBy: [{ date: "asc" }, { sequence: "asc" }],
    }),
    unreconciledBookLines(db, account.ledgerAccountId),
    db.invoice.findMany({
      where: { status: { in: ["APPROVED", "SENT", "PART_PAID"] }, number: { not: null } },
      include: { contact: { select: { name: true } } },
    }),
  ]);
  const settled = (await settledByInvoice(db, invoices.map((i) => i.id))).settled;

  const lines = statement.map((l) => ({
    id: l.id,
    date: ledgerDateKey(l.date),
    amount: toPence(l.amount),
    description: l.description,
    type: l.type,
    balance: l.balance === null ? null : toPence(l.balance),
  }));
  const books: BookLineIn[] = book.map((l) => ({
    journalLineId: l.id,
    date: ledgerDateKey(l.entry.date),
    amount: toPence(l.debit) - toPence(l.credit),
    text: [l.entry.memo, l.entry.reference, l.description].filter(Boolean).join(" "),
    label: l.entry.memo,
  }));
  const open: OpenInvoiceIn[] = invoices
    .map((i) => ({
      id: i.id,
      number: i.number!,
      contactId: i.contactId,
      contactName: i.contact.name,
      amountDue: toPence(i.total) - (settled.get(i.id) ?? 0),
      issueDate: ledgerDateKey(i.issueDate),
    }))
    .filter((i) => i.amountDue > 0);

  return {
    lines,
    suggestions: suggestMatches(lines, books, open),
    openInvoices: open
      .map((i) => ({ ...i }))
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number)),
    bookOnly: book.map((l) => ({
      journalLineId: l.id,
      entryId: l.entry.id,
      journalNumber: l.entry.number,
      date: ledgerDateKey(l.entry.date),
      amount: toPence(l.debit) - toPence(l.credit),
      label: l.entry.memo,
    })),
  };
}

async function lockAccount(tx: Tx, bankAccountId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "bank_accounts" WHERE "id" = ${bankAccountId} FOR UPDATE`;
}

/**
 * Matches statement lines to book entries. Both sides must belong to this
 * account, be unreconciled, and come to the same amount to the penny — the
 * database checks the last part again at commit.
 */
export async function reconcile(
  tx: Tx,
  input: { bankAccountId: string; statementLineIds: string[]; journalLineIds: string[]; method?: "MANUAL" | "AUTO" },
  actor: AuditActor
) {
  if (input.statementLineIds.length === 0 || input.journalLineIds.length === 0) {
    throw new AccountingError("NOTHING_TO_MATCH", "Choose statement lines and the book entries they match", 422);
  }
  await lockAccount(tx, input.bankAccountId);
  const account = await loadAccount(tx, input.bankAccountId);

  const [statement, book] = await Promise.all([
    tx.statementLine.findMany({ where: { id: { in: input.statementLineIds } } }),
    tx.journalLine.findMany({
      where: { id: { in: input.journalLineIds } },
      include: { entry: { select: { status: true } }, reconciled: true },
    }),
  ]);
  if (statement.length !== new Set(input.statementLineIds).size || book.length !== new Set(input.journalLineIds).size) {
    throw new AccountingError("NOT_FOUND", "Some of those lines no longer exist", 404);
  }
  if (statement.some((l) => l.bankAccountId !== account.id)) {
    throw new AccountingError("WRONG_ACCOUNT", "Those statement lines are on another bank account", 422);
  }
  if (statement.some((l) => l.reconciledAt !== null)) {
    throw new AccountingError("ALREADY_RECONCILED", "A statement line is already reconciled; unmatch it first", 409);
  }
  if (book.some((l) => l.accountId !== account.ledgerAccountId || l.entry.status !== "POSTED")) {
    throw new AccountingError("WRONG_ACCOUNT", `Only posted entries on ${account.ledgerAccount.code} can be matched`, 422);
  }
  if (book.some((l) => l.reconciled !== null)) {
    throw new AccountingError("ALREADY_RECONCILED", "A book entry is already matched to the statement", 409);
  }

  const bankSide = sumPence(statement.map((l) => toPence(l.amount)));
  const bookSide = sumPence(book.map((l) => toPence(l.debit) - toPence(l.credit)));
  if (bankSide !== bookSide) {
    throw new AccountingError(
      "NOT_BALANCED",
      `The statement says ${formatPence(bankSide)} and the books ${formatPence(bookSide)}: they must agree to be matched`,
      422
    );
  }

  const reconciliation = await tx.bankReconciliation.create({
    data: { bankAccountId: account.id, method: input.method ?? "MANUAL", createdById: userId(actor) },
  });
  await tx.reconciledJournalLine.createMany({
    data: book.map((l) => ({ journalLineId: l.id, reconciliationId: reconciliation.id })),
  });
  await tx.statementLine.updateMany({
    where: { id: { in: statement.map((l) => l.id) } },
    data: { reconciliationId: reconciliation.id, reconciledAt: new Date() },
  });

  await recordAudit(tx, {
    actor,
    action: "bank.reconcile",
    entityType: "BankReconciliation",
    entityId: reconciliation.id,
    after: {
      ...reconciliation,
      statementLineIds: statement.map((l) => l.id),
      journalLineIds: book.map((l) => l.id),
      amount: fromPence(bankSide),
    },
  });
  return reconciliation;
}

/**
 * Money in that pays open invoices: records the payment (dated on the
 * statement day, into this bank account, settling the invoices in order) and
 * reconciles the line against it, all at once.
 */
export async function reconcileWithInvoices(
  tx: Tx,
  input: { bankAccountId: string; statementLineId: string; invoiceIds: string[]; method?: "MANUAL" | "AUTO" },
  actor: AuditActor
) {
  if (input.invoiceIds.length === 0) throw new AccountingError("NOTHING_TO_MATCH", "Choose the invoices it pays", 422);
  const invoices = await tx.invoice.findMany({ where: { id: { in: input.invoiceIds } } });
  const contacts = new Set(invoices.map((i) => i.contactId));
  if (invoices.length !== input.invoiceIds.length || contacts.size !== 1) {
    throw new AccountingError("WRONG_CUSTOMER", "One payment pays invoices of one customer", 422);
  }
  return reconcileWithReceipt(
    tx,
    {
      bankAccountId: input.bankAccountId,
      statementLineId: input.statementLineId,
      contactId: [...contacts][0],
      // In the order chosen; anything beyond what they owe stays as credit.
      allocations: input.invoiceIds.map((invoiceId) => ({ invoiceId })),
      method: input.method,
    },
    actor
  );
}

/**
 * Records a customer's receipt from an unreconciled money-in statement line —
 * date, amount and bank account are the line's, never retyped — and reconciles
 * the line against it. With no allocations the money is held on account.
 * `bankAccountId` may be omitted when the line is looked up by its own id.
 */
export async function reconcileWithReceipt(
  tx: Tx,
  input: {
    bankAccountId?: string;
    statementLineId: string;
    contactId: string;
    allocations?: { invoiceId: string; amount?: number }[];
    reference?: string | null;
    notes?: string | null;
    method?: "MANUAL" | "AUTO";
  },
  actor: AuditActor
) {
  let bankAccountId = input.bankAccountId;
  if (!bankAccountId) {
    const found = await tx.statementLine.findUnique({
      where: { id: input.statementLineId },
      select: { bankAccountId: true },
    });
    if (!found) throw new AccountingError("NOT_FOUND", "Statement line not found", 404);
    bankAccountId = found.bankAccountId;
  }
  await lockAccount(tx, bankAccountId);
  const account = await loadAccount(tx, bankAccountId);
  const line = await tx.statementLine.findUnique({ where: { id: input.statementLineId } });
  if (!line || line.bankAccountId !== account.id) throw new AccountingError("NOT_FOUND", "Statement line not found", 404);
  if (line.reconciledAt) throw new AccountingError("ALREADY_RECONCILED", "That line is already reconciled", 409);
  const amount = toPence(line.amount);
  if (amount <= 0) throw new AccountingError("NOT_MONEY_IN", "Only money in can pay an invoice", 422);

  const receipt = await recordReceipt(
    tx,
    {
      contactId: input.contactId,
      date: line.date,
      amount,
      bankAccountId: account.ledgerAccountId,
      reference: input.reference?.trim() || line.description.slice(0, 100),
      notes: input.notes?.trim() || "Recorded from the bank statement",
      allocations: input.allocations,
    },
    actor
  );
  const bankLine = await tx.journalLine.findFirstOrThrow({
    where: { entryId: receipt.journalEntryId, accountId: account.ledgerAccountId },
  });
  const reconciliation = await reconcile(
    tx,
    {
      bankAccountId: account.id,
      statementLineIds: [line.id],
      journalLineIds: [bankLine.id],
      method: input.method,
    },
    actor
  );
  return { reconciliation, paymentId: receipt.id };
}

/**
 * A statement line with nothing in the books yet — bank charges, a card
 * purchase, HMRC: posts it to the chosen account on the statement date and
 * reconciles it. Money out debits the account, money in credits it. Trade
 * debtors is refused (use an invoice or a payment, so the customer's account
 * stays right), and so is the bank's own account.
 */
export async function createAndReconcile(
  tx: Tx,
  input: { bankAccountId: string; statementLineId: string; accountId: string; memo?: string | null },
  actor: AuditActor
) {
  await lockAccount(tx, input.bankAccountId);
  const account = await loadAccount(tx, input.bankAccountId);
  const line = await tx.statementLine.findUnique({ where: { id: input.statementLineId } });
  if (!line || line.bankAccountId !== account.id) throw new AccountingError("NOT_FOUND", "Statement line not found", 404);
  if (line.reconciledAt) throw new AccountingError("ALREADY_RECONCILED", "That line is already reconciled", 409);

  const target = await tx.ledgerAccount.findUnique({ where: { id: input.accountId } });
  if (!target || target.isArchived) throw new AccountingError("UNKNOWN_ACCOUNT", "Choose a live account", 422);
  if (target.id === account.ledgerAccountId) {
    throw new AccountingError("SAME_ACCOUNT", "A line cannot be posted to its own bank account", 422);
  }
  if (target.code === SYSTEM_ACCOUNT_CODES.TRADE_DEBTORS) {
    throw new AccountingError(
      "USE_INVOICES",
      "Money from customers goes through their invoices: match it to an invoice or record a payment",
      422
    );
  }

  // A journal made earlier for this line blocks a second one — unless it has
  // been reversed, when the line is open again and needs a fresh journal.
  const base = `statement:${line.id}`;
  const earlier = await tx.journalEntry.findMany({
    where: { sourceType: "SYSTEM", OR: [{ sourceId: base }, { sourceId: { startsWith: `${base}:` } }] },
    select: { reversedBy: { select: { id: true } } },
  });
  if (earlier.some((e) => !e.reversedBy)) {
    throw new AccountingError(
      "ALREADY_POSTED",
      "A journal was already posted for this line (it was unmatched later): match that journal instead",
      409
    );
  }
  const sourceId = earlier.length === 0 ? base : `${base}:${earlier.length}`;

  const amount = toPence(line.amount);
  const size = Math.abs(amount);
  let journal;
  try {
    journal = await postNewJournal(
      tx,
      {
        date: line.date,
        memo: (input.memo?.trim() || line.description).slice(0, 300),
        reference: line.type,
        sourceType: "SYSTEM",
        // One live journal per statement line: creating twice would book the money twice.
        sourceId,
        lines:
          amount < 0
            ? [
                { accountId: target.id, debit: size, credit: 0, description: line.description },
                { accountId: account.ledgerAccountId, debit: 0, credit: size, description: line.description },
              ]
            : [
                { accountId: account.ledgerAccountId, debit: size, credit: 0, description: line.description },
                { accountId: target.id, debit: 0, credit: size, description: line.description },
              ],
      },
      actor
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccountingError(
        "ALREADY_POSTED",
        "A journal was already posted for this line (it was unmatched later): match that journal instead",
        409
      );
    }
    throw error;
  }

  const bankLine = await tx.journalLine.findFirstOrThrow({
    where: { entryId: journal.id, accountId: account.ledgerAccountId },
  });
  const reconciliation = await reconcile(
    tx,
    { bankAccountId: account.id, statementLineIds: [line.id], journalLineIds: [bankLine.id] },
    actor
  );
  return { reconciliation, journalEntryId: journal.id };
}

/**
 * Undoes a match. Only the link goes: a payment or journal that matching
 * created stays in the books, ready to be matched again or voided.
 */
export async function unreconcile(tx: Tx, reconciliationId: string, actor: AuditActor) {
  const existing = await tx.bankReconciliation.findUnique({
    where: { id: reconciliationId },
    include: { statementLines: { select: { id: true } }, journalLines: true },
  });
  if (!existing) throw new AccountingError("NOT_FOUND", "That match no longer exists", 404);
  await lockAccount(tx, existing.bankAccountId);

  await tx.statementLine.updateMany({
    where: { reconciliationId },
    data: { reconciliationId: null, reconciledAt: null },
  });
  await tx.bankReconciliation.delete({ where: { id: reconciliationId } });
  await recordAudit(tx, {
    actor,
    action: "bank.unreconcile",
    entityType: "BankReconciliation",
    entityId: reconciliationId,
    before: existing,
  });
}

/**
 * Applies every suggestion that is safe without a person: HIGH confidence,
 * the line's only HIGH candidate, and nothing else claiming the same entry or
 * invoice. Everything else is left for the reconcile screen.
 */
export async function autoReconcile(tx: Tx, bankAccountId: string, actor: AuditActor) {
  const view = await reconcileView(tx, bankAccountId);
  let matched = 0;
  let paymentsRecorded = 0;
  for (const suggestion of view.suggestions) {
    const pick: Candidate | null = suggestion.auto;
    if (!pick) continue;
    if (pick.kind === "BOOK") {
      await reconcile(
        tx,
        { bankAccountId, statementLineIds: [suggestion.statementLineId], journalLineIds: pick.journalLineIds, method: "AUTO" },
        actor
      );
    } else {
      await reconcileWithInvoices(
        tx,
        { bankAccountId, statementLineId: suggestion.statementLineId, invoiceIds: pick.invoiceIds, method: "AUTO" },
        actor
      );
      paymentsRecorded++;
    }
    matched++;
  }
  return { matched, paymentsRecorded, left: view.lines.length - matched };
}
