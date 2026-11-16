import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HERMES_ACTOR } from "@/lib/audit";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/constants";
import { toLedgerDate } from "@/lib/accounting/dates";
import { AccountingError } from "@/lib/accounting/errors";
import { toLineDrafts } from "@/lib/accounting/input";
import { createDraftJournal, postJournal, postNewJournal } from "@/lib/accounting/posting";
import { serializeEntry } from "@/lib/accounting/serialize";
import { journalSchema } from "@/schemas/books";
import { tryCatchTool, defineTool } from "../errors";

/**
 * Manual journals for the Hermes agent: the same rules and the same service
 * as POST /api/books/journals (`posting.ts` is the only code that writes the
 * ledger), with the journal, its number and its audit row in one transaction.
 */

const entryInclude = {
  lines: {
    orderBy: { lineNumber: "asc" },
    include: { account: { select: { code: true, name: true } } },
  },
  reversedBy: { select: { id: true, number: true } },
} satisfies Prisma.JournalEntryInclude;

/**
 * A broken rule of the books comes back as a result the agent can act on —
 * `{ error, code, problems }`, with the line each problem belongs to — the
 * same body the web route answers with.
 */
async function booksResult<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AccountingError) {
      return { error: error.message, code: error.code, problems: error.problems };
    }
    throw error;
  }
}

const CALENDAR_DATE = /^(\d{4}-\d{2}-\d{2})(T.*)?$/;

/** YYYY-MM-DD, or the date part of an ISO timestamp as reads return it. */
function dateArg(value: unknown): unknown {
  return typeof value === "string" ? (CALENDAR_DATE.exec(value)?.[1] ?? value) : value;
}

/**
 * Lines may name an account by its four-digit code instead of its id, which
 * is what an agent reading the chart of accounts actually has to hand.
 */
async function resolveAccounts(lines: unknown): Promise<unknown> {
  if (!Array.isArray(lines)) return lines;
  const codes = [
    ...new Set(
      lines
        .filter((l) => l && typeof l === "object" && !l.accountId && l.accountCode !== undefined)
        .map((l) => String(l.accountCode))
    ),
  ];
  if (codes.length === 0) return lines;
  const found = await prisma.ledgerAccount.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const idOf = new Map(found.map((a) => [a.code, a.id]));
  const problems = lines.flatMap((l, i) =>
    l && typeof l === "object" && !l.accountId && l.accountCode !== undefined && !idOf.has(String(l.accountCode))
      ? [{ code: "UNKNOWN_ACCOUNT", message: `No account has the code ${String(l.accountCode)}`, line: i + 1 }]
      : []
  );
  if (problems.length > 0) throw new AccountingError("INVALID_JOURNAL", "Journal names accounts that do not exist", 422, problems);
  return lines.map((l) => {
    if (!l || typeof l !== "object" || l.accountId || l.accountCode === undefined) return l;
    const { accountCode, ...rest } = l;
    return { ...rest, accountId: idOf.get(String(accountCode)) };
  });
}

const loadEntry = (id: string) => prisma.journalEntry.findUnique({ where: { id }, include: entryInclude });

export function registerJournalTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("ledger_account_list", defineTool(
    "The chart of accounts: every ledger account with its id, four-digit code, name and type (ASSET, LIABILITY, EQUITY, INCOME, EXPENSE). Use it to find the accounts a journal's lines post to. Archived accounts are left out unless includeArchived is true; they cannot be posted to.",
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] },
        includeArchived: { type: "boolean" },
      },
    },
    async (args) =>
      tryCatchTool(async () => {
        const type = typeof args.type === "string" ? args.type : undefined;
        return prisma.ledgerAccount.findMany({
          where: {
            ...(args.includeArchived === true ? {} : { isArchived: false }),
            ...(type ? { type: type as Prisma.LedgerAccountWhereInput["type"] } : {}),
          },
          select: { id: true, code: true, name: true, type: true, isSystem: true, isArchived: true },
          orderBy: { code: "asc" },
        });
      })
  ));

  handlers.set("journal_create", defineTool(
    "Create a manual journal in the general ledger (the same as POST /api/books/journals). By default it is saved as a DRAFT, which may be unbalanced and can still be posted later with journal_post; pass post: true to post it at once. Posting needs at least two lines, debits equal to credits, live accounts and a date after the lock date; it allocates the next journal number and makes the entry permanent — a posted journal cannot be edited or deleted, only reversed in the app. Each line has exactly one of debit or credit, in pounds (\"125.50\" or 125.5 — no currency signs or thousands separators). Do not use this for money that belongs on a customer's or supplier's account (use invoices, bills and their payments) or for a bank statement line (use reconciliation_create_and_reconcile, which posts and matches in one step). A broken rule is returned as { error, code, problems }, each problem naming its line. Returns the journal with its lines and totals; amounts in the result are integer pence (12000 is £120.00), as in the web API.",
    {
      type: "object",
      properties: {
        date: { type: "string", description: "Ledger date, YYYY-MM-DD" },
        memo: { type: "string", description: "What the journal is for (max 300 characters)" },
        reference: { type: "string", description: "Optional external reference (max 100 characters)" },
        post: { type: "boolean", description: "Post immediately instead of leaving a draft. Default false." },
        lines: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Ledger account id (from ledger_account_list). Give this or accountCode." },
              accountCode: { type: "string", description: "Four-digit account code, e.g. \"7900\", instead of accountId" },
              debit: { type: ["string", "number"], description: "Amount in pounds; leave out on a credit line" },
              credit: { type: ["string", "number"], description: "Amount in pounds; leave out on a debit line" },
              description: { type: "string" },
              projectId: { type: "string", description: "Optional tracking dimension" },
              phaseId: { type: "string", description: "Optional tracking dimension" },
              milestoneId: { type: "string", description: "Optional tracking dimension" },
            },
          },
        },
      },
      required: ["date", "memo", "lines"],
    },
    async (args) =>
      tryCatchTool(() =>
        booksResult(async () => {
          const validation = journalSchema.safeParse({
            ...args,
            date: dateArg(args.date),
            lines: await resolveAccounts(args.lines),
          });
          if (!validation.success) return { error: "Invalid request data", details: validation.error.flatten() };
          const data = validation.data;
          const input = {
            date: toLedgerDate(data.date),
            memo: data.memo,
            reference: data.reference ?? null,
            lines: toLineDrafts(data.lines),
          };
          const entry = await prisma.$transaction((tx) =>
            data.post ? postNewJournal(tx, input, HERMES_ACTOR) : createDraftJournal(tx, input, HERMES_ACTOR)
          );
          return serializeEntry(await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id }, include: entryInclude }));
        })
      )
  ));

  handlers.set("journal_post", defineTool(
    "Post a draft journal: checks that it balances, allocates the next journal number and makes it permanent. Cannot be undone except by a reversal. A broken rule is returned as { error, code, problems }.",
    {
      type: "object",
      properties: { id: { type: "string", description: "The draft journal's id" } },
      required: ["id"],
    },
    async (args) =>
      tryCatchTool(() =>
        booksResult(async () => {
          const posted = await prisma.$transaction((tx) => postJournal(tx, String(args.id), HERMES_ACTOR));
          return serializeEntry(await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.id }, include: entryInclude }));
        })
      )
  ));

  handlers.set("journal_get", defineTool(
    "One journal with its lines, accounts and totals. Amounts are integer pence (12000 is £120.00).",
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async (args) =>
      tryCatchTool(async () => {
        const entry = await loadEntry(String(args.id));
        return entry ? serializeEntry(entry) : { error: "Journal not found" };
      })
  ));

  handlers.set("journal_list", defineTool(
    `Journals, newest first by ledger date, with their lines (amounts in integer pence). Filter by status (DRAFT or POSTED), a date range and an account. Returns { entries, nextCursor, hasMore }; pass nextCursor as cursor for the next page (default ${DEFAULT_PAGE_LIMIT} per page, at most ${MAX_PAGE_LIMIT}).`,
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["DRAFT", "POSTED"] },
        from: { type: "string", description: "Earliest ledger date, YYYY-MM-DD" },
        to: { type: "string", description: "Latest ledger date, YYYY-MM-DD" },
        accountId: { type: "string", description: "Only journals with a line on this account" },
        limit: { type: "number" },
        cursor: { type: "string" },
      },
    },
    async (args) =>
      tryCatchTool(() =>
        booksResult(async () => {
          const status = args.status === "DRAFT" || args.status === "POSTED" ? args.status : undefined;
          const from = args.from ? String(dateArg(args.from)) : null;
          const to = args.to ? String(dateArg(args.to)) : null;
          const take = Math.min(Math.max(Math.trunc(Number(args.limit)) || DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
          const entries = await prisma.journalEntry.findMany({
            where: {
              ...(status ? { status } : {}),
              ...(from || to
                ? { date: { ...(from ? { gte: toLedgerDate(from) } : {}), ...(to ? { lte: toLedgerDate(to) } : {}) } }
                : {}),
              ...(args.accountId ? { lines: { some: { accountId: String(args.accountId) } } } : {}),
            },
            include: entryInclude,
            take: take + 1,
            ...(args.cursor ? { skip: 1, cursor: { id: String(args.cursor) } } : {}),
            orderBy: [{ date: "desc" }, { id: "desc" }],
          });
          const hasMore = entries.length > take;
          if (hasMore) entries.pop();
          return {
            entries: entries.map(serializeEntry),
            nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
            hasMore,
          };
        })
      )
  ));
}
