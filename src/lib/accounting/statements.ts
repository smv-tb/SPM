import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { fromPence, toPence, type Pence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { AccountingError } from "./errors";
import { userId } from "./invoices";
import { isBankAccountCode } from "./payment";
import { markBankDetailsChanged } from "./bank-details-change";
import {
  auditableBankAccount, bankAccountIndex, bankAccountNumberContext, duplicateWhere, openNumber, sealNumber,
} from "./bank-numbers";
import { randomUUID } from "node:crypto";
import { actorLabel } from "@/lib/security-alerts";
import {
  StatementFileError,
  buildLines,
  checkBalances,
  chronological,
  decodeStatement,
  detectDelimiter,
  fingerprintKeys,
  parseCsv,
  profileFrom,
  resolveColumns,
  type BalanceBreak,
  type ColumnProblem,
  type ImportProfile,
  type ParsedLine,
} from "./statement-import";

/**
 * The only code that writes bank accounts, statement imports and statement
 * lines. A statement is the bank's record, not a posting: nothing here
 * touches the ledger. Reconciliation (Phase 6) matches lines to the books.
 */

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "bankAccount" | "statementLine">;

// ── Bank accounts ───────────────────────────────────────────────────────────

export interface BankAccountInput {
  name: string;
  ledgerAccountId: string;
  sortCode: string;
  accountNumber: string;
}

function normaliseDetails(input: { sortCode: string; accountNumber: string }) {
  const sortCode = input.sortCode.replace(/[\s-]/g, "");
  const accountNumber = input.accountNumber.replace(/\s/g, "");
  if (!/^\d{6}$/.test(sortCode)) {
    throw new AccountingError("INVALID_SORT_CODE", "A sort code is six digits, e.g. 30-99-50", 422);
  }
  if (!/^\d{8}$/.test(accountNumber)) {
    throw new AccountingError("INVALID_ACCOUNT_NUMBER", "An account number is eight digits", 422);
  }
  return { sortCode, accountNumber };
}

export async function createBankAccount(tx: Tx, input: BankAccountInput, actor: AuditActor) {
  const ledger = await tx.ledgerAccount.findUnique({ where: { id: input.ledgerAccountId } });
  if (!ledger || ledger.type !== "ASSET" || !isBankAccountCode(ledger.code) || ledger.isArchived) {
    throw new AccountingError("NOT_A_BANK_ACCOUNT", "Choose a live 12xx bank account in the chart", 422);
  }
  if (await tx.bankAccount.findUnique({ where: { ledgerAccountId: ledger.id } })) {
    throw new AccountingError(
      "ALREADY_LINKED",
      `${ledger.code} ${ledger.name} already has a bank account`,
      409
    );
  }
  const details = normaliseDetails(input);
  if (await tx.bankAccount.findFirst({ where: duplicateWhere(details.sortCode, details.accountNumber) })) {
    throw new AccountingError("DUPLICATE_ACCOUNT", "That sort code and account number are already set up", 409);
  }

  // The id is chosen here because the sealed number is bound to its own row.
  const id = randomUUID();
  const account = await tx.bankAccount.create({
    data: {
      id,
      name: input.name.trim(),
      ledgerAccountId: ledger.id,
      sortCode: details.sortCode,
      accountNumber: sealNumber(details.accountNumber, bankAccountNumberContext(id)),
      accountNumberIdx: bankAccountIndex(details.sortCode, details.accountNumber),
    },
  });
  await recordAudit(tx, {
    actor,
    action: "bank_account.create",
    entityType: "BankAccount",
    entityId: account.id,
    after: auditableBankAccount(account),
  });
  // A new place for money to go is a change of payee details, like editing one.
  await markBankDetailsChanged(tx, actorLabel(actor));
  return account;
}

export async function updateBankAccount(
  tx: Tx,
  id: string,
  input: { name?: string; sortCode?: string; accountNumber?: string; isArchived?: boolean },
  actor: AuditActor
) {
  const existing = await tx.bankAccount.findUnique({ where: { id } });
  if (!existing) throw new AccountingError("NOT_FOUND", "Bank account not found", 404);

  const data: Prisma.BankAccountUpdateInput = {};
  const currentNumber = openNumber(existing.accountNumber, bankAccountNumberContext(id));
  let detailsChanged = false;
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.isArchived !== undefined) data.isArchived = input.isArchived;
  if (input.sortCode !== undefined || input.accountNumber !== undefined) {
    // Imported lines were checked against these details; changing them
    // afterwards would make that check meaningless.
    if (await tx.statementLine.count({ where: { bankAccountId: id } })) {
      throw new AccountingError(
        "HAS_STATEMENTS",
        "Statements have been imported against these details; they cannot change now",
        409
      );
    }
    const details = normaliseDetails({
      sortCode: input.sortCode ?? existing.sortCode,
      accountNumber: input.accountNumber ?? openNumber(existing.accountNumber, bankAccountNumberContext(id)),
    });
    const changed = details.sortCode !== existing.sortCode || details.accountNumber !== currentNumber;
    if (changed) {
      const clash = await tx.bankAccount.findFirst({
        where: { id: { not: id }, ...duplicateWhere(details.sortCode, details.accountNumber) },
      });
      if (clash) throw new AccountingError("DUPLICATE_ACCOUNT", "That sort code and account number are already set up", 409);
    }
    // Written even when unchanged, so an edit also converts a legacy plain-text row.
    data.sortCode = details.sortCode;
    data.accountNumber = sealNumber(details.accountNumber, bankAccountNumberContext(id));
    data.accountNumberIdx = bankAccountIndex(details.sortCode, details.accountNumber);
    detailsChanged = changed;
  }

  const account = await tx.bankAccount.update({ where: { id }, data });
  await recordAudit(tx, {
    actor,
    action: "bank_account.update",
    entityType: "BankAccount",
    entityId: id,
    before: auditableBankAccount(existing),
    after: auditableBankAccount(account),
  });
  if (detailsChanged) await markBankDetailsChanged(tx, actorLabel(actor));
  return { ...account, detailsChanged };
}

// ── Reading a file ──────────────────────────────────────────────────────────

export interface PreviewLine extends ParsedLine {
  duplicate: boolean;
}

export interface StatementPreview {
  encoding: string;
  delimiter: string;
  header: string[];
  profile: ImportProfile;
  columnProblems: ColumnProblem[];
  /** Oldest first. */
  lines: PreviewLine[];
  counts: { total: number; invalid: number; duplicates: number; toImport: number };
  balances: { breaks: BalanceBreak[]; opening: Pence | null; closing: Pence | null };
  /**
   * Does the file pick up where the account's statement already stands?
   * Null when there is nothing to compare (no earlier lines, or no balances).
   */
  continuity: { previousBalance: Pence; previousDate: string; follows: boolean } | null;
  firstDate: string | null;
  lastDate: string | null;
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/**
 * Reads a statement file for one account without writing anything: every
 * line with its errors, which ones are already imported, and the balance
 * checks. Import runs exactly this again before it writes.
 */
export async function previewStatement(
  db: Reader,
  bankAccountId: string,
  bytes: Uint8Array,
  profileOverride?: unknown
): Promise<StatementPreview & { fingerprints: string[] }> {
  const account = await db.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!account) throw new AccountingError("NOT_FOUND", "Bank account not found", 404);
  if (account.isArchived) throw new AccountingError("ARCHIVED", `${account.name} is archived`, 409);

  const profile = profileFrom(profileOverride ?? account.importProfile);
  let decoded: ReturnType<typeof decodeStatement>;
  let rows: string[][];
  let delimiter: string;
  try {
    decoded = decodeStatement(bytes);
    delimiter = detectDelimiter(decoded.text);
    rows = parseCsv(decoded.text, delimiter);
  } catch (error) {
    if (error instanceof StatementFileError) throw new AccountingError("BAD_FILE", error.message, 422);
    throw error;
  }
  if (rows.length < 2) throw new AccountingError("BAD_FILE", "The file has a header but no lines", 422);

  const [header, ...data] = rows;
  const { index, problems } = resolveColumns(header, profile);
  const base = {
    encoding: decoded.encoding,
    delimiter,
    header: header.map((h) => h.replace(/^﻿/, "").trim()),
    profile,
    columnProblems: problems,
  };
  if (problems.length > 0) {
    return {
      ...base,
      lines: [],
      counts: { total: data.length, invalid: data.length, duplicates: 0, toImport: 0 },
      balances: { breaks: [], opening: null, closing: null },
      continuity: null,
      firstDate: null,
      lastDate: null,
      fingerprints: [],
    };
  }

  let parsed: ParsedLine[];
  try {
    parsed = chronological(
      buildLines(data, index, profile, {
        sortCode: account.sortCode,
        accountNumber: openNumber(account.accountNumber, bankAccountNumberContext(account.id)),
      })
    );
  } catch (error) {
    if (error instanceof StatementFileError) throw new AccountingError("BAD_FILE", error.message, 422);
    throw error;
  }
  const fingerprints = fingerprintKeys(account.id, parsed).map((key) => sha256(key));
  const existing = new Set(
    (
      await db.statementLine.findMany({
        where: { bankAccountId: account.id, fingerprint: { in: fingerprints } },
        select: { fingerprint: true },
      })
    ).map((l) => l.fingerprint)
  );
  const lines: PreviewLine[] = parsed.map((line, i) => ({ ...line, duplicate: existing.has(fingerprints[i]) }));
  const fresh = lines.filter((l) => !l.duplicate && l.errors.length === 0);

  // Does the first new line follow the last line already held before it?
  let continuity: StatementPreview["continuity"] = null;
  const first = fresh[0];
  if (first?.date && first.balance !== null && first.amount !== null) {
    const previous = await db.statementLine.findFirst({
      where: { bankAccountId: account.id, date: { lte: new Date(`${first.date}T00:00:00Z`) }, balance: { not: null } },
      orderBy: [{ date: "desc" }, { sequence: "desc" }],
    });
    if (previous?.balance) {
      const previousBalance = toPence(previous.balance);
      continuity = {
        previousBalance,
        previousDate: previous.date.toISOString().slice(0, 10),
        follows: previousBalance + first.amount === first.balance,
      };
    }
  }

  const dates = lines.flatMap((l) => (l.date ? [l.date] : [])).sort();
  return {
    ...base,
    lines,
    counts: {
      total: lines.length,
      invalid: lines.filter((l) => l.errors.length > 0).length,
      duplicates: lines.filter((l) => l.duplicate).length,
      toImport: fresh.length,
    },
    balances: checkBalances(lines),
    continuity,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    fingerprints,
  };
}

// ── Importing ───────────────────────────────────────────────────────────────

export interface ImportOptions {
  fileName: string;
  bytes: Uint8Array;
  profile?: unknown;
  /** The running balance does not follow somewhere in the file; import anyway. */
  allowBalanceBreaks?: boolean;
}

/**
 * Imports a statement file: re-reads it exactly as the preview did, refuses
 * it while any line is wrong, skips lines already held (they are shown, not
 * silently dropped) and writes the rest as one import. The account row is
 * locked so two imports of the same account queue.
 */
export async function importStatement(tx: Tx, bankAccountId: string, options: ImportOptions, actor: AuditActor) {
  await tx.$queryRaw`SELECT 1 FROM "bank_accounts" WHERE "id" = ${bankAccountId} FOR UPDATE`;
  const preview = await previewStatement(tx, bankAccountId, options.bytes, options.profile);

  if (preview.columnProblems.length > 0) {
    throw new AccountingError("BAD_COLUMNS", "Match the file's columns before importing", 422);
  }
  if (preview.counts.invalid > 0) {
    throw new AccountingError(
      "INVALID_LINES",
      `${preview.counts.invalid} line${preview.counts.invalid === 1 ? " has" : "s have"} errors; fix the file or the format and try again`,
      422
    );
  }
  if (preview.balances.breaks.length > 0 && !options.allowBalanceBreaks) {
    throw new AccountingError(
      "BALANCE_BREAKS",
      "The running balance does not follow on every line: a line may be missing. Check the file, or confirm to import anyway",
      422
    );
  }
  if (preview.counts.toImport === 0) {
    throw new AccountingError("NOTHING_NEW", "Every line in this file has already been imported", 409);
  }

  const last = await tx.statementLine.aggregate({ where: { bankAccountId }, _max: { sequence: true } });
  let sequence = last._max.sequence ?? 0;

  const batch = await tx.statementImport.create({
    data: {
      bankAccountId,
      fileName: options.fileName.slice(0, 200),
      fileHash: sha256(options.bytes),
      encoding: preview.encoding,
      lineCount: preview.counts.toImport,
      duplicateCount: preview.counts.duplicates,
      firstDate: preview.firstDate ? new Date(`${preview.firstDate}T00:00:00Z`) : null,
      lastDate: preview.lastDate ? new Date(`${preview.lastDate}T00:00:00Z`) : null,
      openingBalance: preview.balances.opening === null ? null : fromPence(preview.balances.opening),
      closingBalance: preview.balances.closing === null ? null : fromPence(preview.balances.closing),
      createdById: userId(actor),
    },
  });

  try {
    await tx.statementLine.createMany({
      data: preview.lines.flatMap((line, i) =>
        line.duplicate
          ? []
          : [
              {
                bankAccountId,
                importId: batch.id,
                date: new Date(`${line.date}T00:00:00Z`),
                type: line.type,
                description: line.description,
                amount: fromPence(line.amount!),
                balance: line.balance === null ? null : fromPence(line.balance),
                sequence: ++sequence,
                fingerprint: preview.fingerprints[i],
              },
            ]
      ),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccountingError("DUPLICATE_LINES", "Some of these lines were imported a moment ago; preview again", 409);
    }
    throw error;
  }

  // What worked is remembered for this account's next file.
  await tx.bankAccount.update({
    where: { id: bankAccountId },
    data: { importProfile: preview.profile as unknown as Prisma.InputJsonValue },
  });

  await recordAudit(tx, {
    actor,
    action: "statement.import",
    entityType: "StatementImport",
    entityId: batch.id,
    after: {
      ...batch,
      balanceBreaks: preview.balances.breaks,
      allowedBalanceBreaks: Boolean(options.allowBalanceBreaks && preview.balances.breaks.length),
      continuity: preview.continuity,
    },
  });
  return { batch, preview };
}

/**
 * Rolls an import back: its lines go, the import stays on record as undone.
 * Refused once any of its lines has been reconciled.
 */
export async function undoStatementImport(tx: Tx, importId: string, actor: AuditActor) {
  const batch = await tx.statementImport.findUnique({ where: { id: importId } });
  if (!batch) throw new AccountingError("NOT_FOUND", "Import not found", 404);
  if (batch.status === "UNDONE") throw new AccountingError("ALREADY_UNDONE", "This import was already undone", 409);
  await tx.$queryRaw`SELECT 1 FROM "bank_accounts" WHERE "id" = ${batch.bankAccountId} FOR UPDATE`;

  const reconciled = await tx.statementLine.count({ where: { importId, reconciledAt: { not: null } } });
  if (reconciled > 0) {
    throw new AccountingError(
      "RECONCILED",
      `${reconciled} line${reconciled === 1 ? " is" : "s are"} already reconciled; un-reconcile before undoing`,
      409
    );
  }

  const { count } = await tx.statementLine.deleteMany({ where: { importId } });
  const undone = await tx.statementImport.update({
    where: { id: importId },
    data: { status: "UNDONE", undoneAt: new Date(), undoneById: userId(actor) },
  });
  await recordAudit(tx, {
    actor,
    action: "statement.undo",
    entityType: "StatementImport",
    entityId: importId,
    before: batch,
    after: { ...undone, linesRemoved: count },
  });
  return undone;
}

/** The statement's latest balance and the books' balance on the same account. */
export async function bankPosition(
  db: Pick<Tx, "statementLine" | "journalLine">,
  account: { id: string; ledgerAccountId: string }
): Promise<{ statementBalance: Pence | null; statementDate: string | null; booksBalance: Pence; unreconciled: number }> {
  const [latest, books, unreconciled] = await Promise.all([
    db.statementLine.findFirst({
      where: { bankAccountId: account.id, balance: { not: null } },
      orderBy: [{ date: "desc" }, { sequence: "desc" }],
    }),
    db.journalLine.aggregate({
      where: { accountId: account.ledgerAccountId, entry: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    }),
    db.statementLine.count({ where: { bankAccountId: account.id, reconciledAt: null } }),
  ]);
  return {
    statementBalance: latest?.balance ? toPence(latest.balance) : null,
    statementDate: latest ? latest.date.toISOString().slice(0, 10) : null,
    booksBalance: toPence(books._sum.debit ?? 0) - toPence(books._sum.credit ?? 0),
    unreconciled,
  };
}
