import { Prisma, type JournalSourceType } from "@prisma/client";
import { fromPence, toPence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { ledgerDateKey } from "./dates";
import { AccountingError } from "./errors";
import {
  allocateJournalNumber,
  reverseLines,
  validateJournal,
  type AccountRef,
  type JournalLineDraft,
} from "./journal";

/**
 * The only code that writes the general ledger. Every function takes the
 * caller's transaction client so the journal, its audit entry and whatever
 * business change caused it commit or roll back together.
 */

type Tx = Prisma.TransactionClient;

export const COMPANY_SETTINGS_ID = "default";

export interface JournalInput {
  date: Date;
  memo: string;
  reference?: string | null;
  lines: JournalLineDraft[];
  sourceType?: JournalSourceType;
  sourceId?: string | null;
}

const withLines = { lines: { orderBy: { lineNumber: "asc" } } } satisfies Prisma.JournalEntryInclude;

function userId(actor: AuditActor): string | null {
  return actor.type === "USER" ? actor.id : null;
}

async function loadAccounts(tx: Tx, lines: JournalLineDraft[]): Promise<Map<string, AccountRef>> {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.ledgerAccount.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true, isArchived: true },
  });
  return new Map(accounts.map((a) => [a.id, a]));
}

function throwIfProblems(problems: ReturnType<typeof validateJournal>, verb: string): void {
  if (problems.length > 0) {
    throw new AccountingError("INVALID_JOURNAL", `Journal cannot be ${verb}`, 422, problems);
  }
}

function lineRows(lines: JournalLineDraft[]) {
  return lines.map((l, i) => ({
    lineNumber: i + 1,
    accountId: l.accountId,
    description: l.description ?? null,
    debit: fromPence(l.debit),
    credit: fromPence(l.credit),
    projectId: l.projectId ?? null,
    phaseId: l.phaseId ?? null,
    milestoneId: l.milestoneId ?? null,
  }));
}

function toDrafts(lines: { accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; description: string | null; projectId: string | null; phaseId: string | null; milestoneId: string | null }[]): JournalLineDraft[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    debit: toPence(l.debit),
    credit: toPence(l.credit),
    description: l.description,
    projectId: l.projectId,
    phaseId: l.phaseId,
    milestoneId: l.milestoneId,
  }));
}

async function findEntry(tx: Tx, id: string) {
  const entry = await tx.journalEntry.findUnique({ where: { id }, include: withLines });
  if (!entry) throw new AccountingError("NOT_FOUND", "Journal not found", 404);
  return entry;
}

export async function createDraftJournal(tx: Tx, input: JournalInput, actor: AuditActor) {
  const accounts = await loadAccounts(tx, input.lines);
  throwIfProblems(
    validateJournal({ date: input.date, lines: input.lines }, { lockDate: null, accounts, mode: "draft" }),
    "saved"
  );

  const entry = await tx.journalEntry.create({
    data: {
      date: input.date,
      memo: input.memo,
      reference: input.reference ?? null,
      sourceType: input.sourceType ?? "MANUAL",
      sourceId: input.sourceId ?? null,
      createdById: userId(actor),
      lines: { create: lineRows(input.lines) },
    },
    include: withLines,
  });
  await recordAudit(tx, {
    actor,
    action: "journal.create",
    entityType: "JournalEntry",
    entityId: entry.id,
    after: entry,
  });
  return entry;
}

export async function updateDraftJournal(tx: Tx, id: string, input: JournalInput, actor: AuditActor) {
  const existing = await findEntry(tx, id);
  if (existing.status !== "DRAFT") {
    throw new AccountingError("NOT_DRAFT", "Posted journals cannot be edited — reverse them instead", 409);
  }

  const accounts = await loadAccounts(tx, input.lines);
  throwIfProblems(
    validateJournal({ date: input.date, lines: input.lines }, { lockDate: null, accounts, mode: "draft" }),
    "saved"
  );

  await tx.journalLine.deleteMany({ where: { entryId: id } });
  const updated = await tx.journalEntry.update({
    where: { id },
    data: {
      date: input.date,
      memo: input.memo,
      reference: input.reference ?? null,
      lines: { create: lineRows(input.lines) },
    },
    include: withLines,
  });
  await recordAudit(tx, {
    actor,
    action: "journal.update",
    entityType: "JournalEntry",
    entityId: id,
    before: existing,
    after: updated,
  });
  return updated;
}

export async function deleteDraftJournal(tx: Tx, id: string, actor: AuditActor): Promise<void> {
  const existing = await findEntry(tx, id);
  if (existing.status !== "DRAFT") {
    throw new AccountingError("NOT_DRAFT", "Posted journals cannot be deleted — reverse them instead", 409);
  }
  await tx.journalEntry.delete({ where: { id } });
  await recordAudit(tx, {
    actor,
    action: "journal.delete",
    entityType: "JournalEntry",
    entityId: id,
    before: existing,
  });
}

export async function postJournal(tx: Tx, id: string, actor: AuditActor) {
  const entry = await findEntry(tx, id);
  if (entry.status !== "DRAFT") {
    throw new AccountingError("NOT_DRAFT", "Journal is already posted", 409);
  }

  // Taking the next number row-locks the settings row until commit, which
  // serialises concurrent postings — so the lock date read here is current,
  // and a failed posting rolls the counter back (numbers stay gapless).
  const settings = await tx.companySettings.upsert({
    where: { id: COMPANY_SETTINGS_ID },
    update: { nextJournalNumber: { increment: 1 } },
    create: { id: COMPANY_SETTINGS_ID, nextJournalNumber: 2 },
  });
  const highest = await tx.journalEntry.aggregate({ _max: { number: true } });
  const number = allocateJournalNumber(settings.nextJournalNumber - 1, highest._max.number);

  const lines = toDrafts(entry.lines);
  const accounts = await loadAccounts(tx, lines);
  throwIfProblems(
    validateJournal({ date: entry.date, lines }, { lockDate: settings.lockDate, accounts, mode: "post" }),
    "posted"
  );

  let posted;
  try {
    posted = await tx.journalEntry.update({
      where: { id },
      data: { status: "POSTED", number, postedAt: new Date(), postedById: userId(actor) },
      include: withLines,
    });
  } catch (error) {
    // Belt and braces: the clamp above should make this unreachable, but a
    // collision must never surface as a raw database error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccountingError(
        "NUMBER_TAKEN",
        `Journal number ${number} is already in use — the numbering counter is out of step with the ledger`,
        409
      );
    }
    throw error;
  }

  // Keep the counter ahead of the number actually used (the clamp may have
  // skipped it forward past entries the counter did not know about).
  if (settings.nextJournalNumber !== number + 1) {
    await tx.companySettings.update({
      where: { id: COMPANY_SETTINGS_ID },
      data: { nextJournalNumber: number + 1 },
    });
  }

  await recordAudit(tx, {
    actor,
    action: "journal.post",
    entityType: "JournalEntry",
    entityId: id,
    before: { status: entry.status, number: entry.number },
    after: { status: posted.status, number: posted.number },
  });
  return posted;
}

/** Create and post in one step — for automated postings and "Post" from the form. */
export async function postNewJournal(tx: Tx, input: JournalInput, actor: AuditActor) {
  const draft = await createDraftJournal(tx, input, actor);
  return postJournal(tx, draft.id, actor);
}

/**
 * Corrects a posted journal by posting its mirror image. The original stays
 * exactly as it was — that is the point of an immutable ledger.
 */
export async function reverseJournal(
  tx: Tx,
  id: string,
  options: { date: Date; memo?: string | null },
  actor: AuditActor
) {
  const original = await tx.journalEntry.findUnique({
    where: { id },
    include: { ...withLines, reversedBy: { select: { id: true } } },
  });
  if (!original) throw new AccountingError("NOT_FOUND", "Journal not found", 404);
  if (original.status !== "POSTED") {
    throw new AccountingError("NOT_POSTED", "Only posted journals can be reversed — delete the draft instead", 409);
  }
  if (original.reversedBy) {
    throw new AccountingError("ALREADY_REVERSED", "This journal has already been reversed", 409);
  }
  if (original.sourceType === "REVERSAL") {
    throw new AccountingError(
      "REVERSAL_OF_REVERSAL",
      "A reversal cannot itself be reversed — post a new journal instead",
      409
    );
  }
  if (ledgerDateKey(options.date) < ledgerDateKey(original.date)) {
    throw new AccountingError("INVALID_DATE", "A reversal cannot be dated before the journal it reverses", 422);
  }
  // The bank statement says this money moved; reversing it would leave the
  // statement matched to nothing. Unmatch first, then correct.
  if (await tx.reconciledJournalLine.count({ where: { journalLine: { entryId: id } } })) {
    throw new AccountingError(
      "RECONCILED",
      "This is matched to a bank statement line: unmatch it on the reconcile screen before voiding or reversing it",
      409
    );
  }

  let draft;
  try {
    draft = await tx.journalEntry.create({
      data: {
        date: options.date,
        memo: options.memo?.trim() || `Reversal of journal #${original.number}`,
        reference: original.reference,
        sourceType: "REVERSAL",
        reversesId: original.id,
        createdById: userId(actor),
        lines: { create: lineRows(reverseLines(toDrafts(original.lines))) },
      },
    });
  } catch (error) {
    // Two people reversing at once: the unique reversesId lets only one win.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccountingError("ALREADY_REVERSED", "This journal has already been reversed", 409);
    }
    throw error;
  }

  await recordAudit(tx, {
    actor,
    action: "journal.reverse",
    entityType: "JournalEntry",
    entityId: original.id,
    after: { reversedById: draft.id },
  });
  return postJournal(tx, draft.id, actor);
}
