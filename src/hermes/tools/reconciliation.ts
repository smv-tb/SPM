import { prisma } from "@/lib/prisma";
import { bankAccountNumberContext, maskNumber, openNumber } from "@/lib/accounting/bank-numbers";
import { HERMES_ACTOR } from "@/lib/audit";
import {
  reconcileView,
  reconcile,
  reconcileWithInvoices,
  createAndReconcile,
  unreconcile,
  autoReconcile,
} from "@/lib/accounting/reconciliation";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";

export function registerReconciliationTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("reconciliation_view", defineTool(
    "Everything the reconcile screen needs: unreconciled statement lines, auto-suggestions, and loose book entries (entries in the books not yet matched to the statement). Returns an object with `lines`, `suggestions` and `bookOnly`.",
    {
      type: "object",
      properties: {
        bankAccountId: { type: "string", description: "Bank account ID" },
      },
      required: ["bankAccountId"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const bankAccountId = String(args.bankAccountId);
        const view = await reconcileView(prisma, bankAccountId);
        return createToolResponse(view);
      });
    }
  ));

  handlers.set("reconciliation_create", defineTool(
    `Match statement lines to book entries. Both sides must belong to the same bank account, be unreconciled, and come to the same total amount. Returns the created BankReconciliation.`,
    {
      type: "object",
      properties: {
        bankAccountId: { type: "string" },
        statementLineIds: { type: "array", items: { type: "string" }, minItems: 1 },
        journalLineIds: { type: "array", items: { type: "string" }, minItems: 1 },
        method: { type: "string", enum: ["MANUAL", "AUTO"] },
      },
      required: ["bankAccountId", "statementLineIds", "journalLineIds"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const bankAccountId = String(args.bankAccountId);
        const statementLineIds = (args.statementLineIds as string[]).map(String);
        const journalLineIds = (args.journalLineIds as string[]).map(String);
        const method = args.method ? String(args.method) as "MANUAL" | "AUTO" : undefined;
        const result = await prisma.$transaction(async (tx) => {
          return reconcile(
            tx,
            { bankAccountId, statementLineIds, journalLineIds, method },
            HERMES_ACTOR
          );
        });
        return createToolResponse(result);
      });
    }
  ));

  handlers.set("reconciliation_with_invoices", defineTool(
    "Record a receipt for an inbound payment on a statement line and reconcile it against one or more open invoices of the same customer. Money in only (positive amount). Returns { reconciliation, paymentId }.",
    {
      type: "object",
      properties: {
        bankAccountId: { type: "string" },
        statementLineId: { type: "string" },
        invoiceIds: { type: "array", items: { type: "string" }, minItems: 1 },
        method: { type: "string", enum: ["MANUAL", "AUTO"] },
      },
      required: ["bankAccountId", "statementLineId", "invoiceIds"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const bankAccountId = String(args.bankAccountId);
        const statementLineId = String(args.statementLineId);
        const invoiceIds = (args.invoiceIds as string[]).map(String);
        const method = args.method ? String(args.method) as "MANUAL" | "AUTO" : undefined;
        const result = await prisma.$transaction(async (tx) => {
          return reconcileWithInvoices(
            tx,
            { bankAccountId, statementLineId, invoiceIds, method },
            HERMES_ACTOR
          );
        });
        return createToolResponse(result);
      });
    }
  ));

  handlers.set("reconciliation_create_and_reconcile", defineTool(
    "A statement line with nothing in the books yet (bank charges, card purchases, HMRC, etc.): posts a journal to the chosen account on the statement date and reconciles it in one step. Money out debits the target account, money in credits it. Trade Debtors and the bank's own account are refused. Returns { reconciliation, journalEntryId }.",
    {
      type: "object",
      properties: {
        bankAccountId: { type: "string", description: "The bank account the statement line sits on" },
        statementLineId: { type: "string" },
        accountId: { type: "string", description: "The ledger account to post the other side to (not the bank account, not Trade Debtors)" },
        memo: { type: "string", description: "Optional memo for the journal entry (defaults to the statement line description)" },
      },
      required: ["bankAccountId", "statementLineId", "accountId"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const bankAccountId = String(args.bankAccountId);
        const statementLineId = String(args.statementLineId);
        const accountId = String(args.accountId);
        const memo = args.memo ? String(args.memo) : undefined;
        const result = await prisma.$transaction(async (tx) => {
          return createAndReconcile(
            tx,
            { bankAccountId, statementLineId, accountId, memo },
            HERMES_ACTOR
          );
        });
        return createToolResponse(result);
      });
    }
  ));

  handlers.set("reconciliation_unreconcile", defineTool(
    "Undo a reconciliation match. The journal or payment that matching created stays in the books — only the link to the statement is removed. Reports the removed reconciliation in the audit trail.",
    {
      type: "object",
      properties: {
        reconciliationId: { type: "string", description: "The BankReconciliation ID (returned by reconciliation_create / reconciliation_with_invoices / reconciliation_create_and_reconcile)" },
      },
      required: ["reconciliationId"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const reconciliationId = String(args.reconciliationId);
        await prisma.$transaction(async (tx) => {
          await unreconcile(tx, reconciliationId, HERMES_ACTOR);
        });
        return createToolResponse({ ok: true });
      });
    }
  ));

  handlers.set("reconciliation_auto", defineTool(
    "Apply every safe auto-reconciliation suggestion: HIGH-confidence matches that no other line competes for. Returns { matched, paymentsRecorded, left } (how many lines were matched, how many payments were recorded, and how many unreconciled lines remain for manual review).",
    {
      type: "object",
      properties: {
        bankAccountId: { type: "string" },
      },
      required: ["bankAccountId"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const bankAccountId = String(args.bankAccountId);
        const result = await prisma.$transaction(async (tx) => {
          return autoReconcile(tx, bankAccountId, HERMES_ACTOR);
        });
        return createToolResponse(result);
      });
    }
  ));

  handlers.set("reconciliation_bank_accounts", defineTool(
    "List all bank accounts with their ledger account details, statement line counts (total and unreconciled), and latest balance.",
    {
      type: "object",
      properties: {},
    },
    async () => {
      return tryCatchTool(async () => {
        const accounts = await prisma.bankAccount.findMany({
          where: { isArchived: false },
          include: {
            ledgerAccount: { select: { id: true, code: true, name: true } },
            _count: { select: { lines: true } },
          },
          orderBy: { name: "asc" },
        });
        const enriched = await Promise.all(
          accounts.map(async (a) => {
            const unreconciled = await prisma.statementLine.count({
              where: { bankAccountId: a.id, reconciledAt: null },
            });
            const lastLine = await prisma.statementLine.findFirst({
              where: { bankAccountId: a.id, balance: { not: null } },
              orderBy: [{ date: "desc" }, { sequence: "desc" }],
            });
            return {
              id: a.id,
              name: a.name,
              sortCode: a.sortCode,
              accountNumberMasked: maskNumber(openNumber(a.accountNumber, bankAccountNumberContext(a.id))),
              ledgerAccount: a.ledgerAccount,
              totalLines: a._count.lines,
              unreconciledLines: unreconciled,
              latestBalance: lastLine?.balance ? Number(lastLine.balance) : null,
            };
          })
        );
        return createToolResponse(enriched);
      });
    }
  ));
}