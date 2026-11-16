import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

const transaction = vi.fn();
const findAccounts = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: unknown[]) => transaction(...a),
    ledgerAccount: { findMany: (...a: unknown[]) => findAccounts(...a) },
  },
}));

import { registerJournalTools } from "@/hermes/tools/journals";
import { registerAllTools } from "@/hermes/tools";
import { tryCatchTool, type ToolHandler } from "@/hermes/errors";
import { AccountingError } from "@/lib/accounting/errors";

const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
registerJournalTools(handlers);
const create = (args: Record<string, unknown>) => handlers.get("journal_create")!(args) as Promise<Record<string, unknown>>;
const ID = "3f0c1c52-8d1e-4f5e-9a55-0d6f3f1f2a10";

beforeEach(() => {
  transaction.mockReset();
  findAccounts.mockReset();
});

describe("Hermes journal tools", () => {
  it("are served, each with a description and a schema", () => {
    const all = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    registerAllTools(all);
    for (const name of ["ledger_account_list", "journal_create", "journal_post", "journal_get", "journal_list"]) {
      const tool = all.get(name) as ToolHandler | undefined;
      expect(tool?.description, name).toBeTruthy();
      expect(tool?.inputSchema, name).toBeTruthy();
    }
  });

  it("refuses a malformed journal before touching the database", async () => {
    const r = await create({ date: "01/12/2026", memo: "", lines: [] });
    expect(r.error).toBe("Invalid request data");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("names the line with an amount it cannot read", async () => {
    const r = await create({
      date: "2026-12-01",
      memo: "Accrual",
      lines: [
        { accountId: ID, debit: "1,200.00" },
        { accountId: ID, credit: "1200.00" },
      ],
    });
    expect(r).toMatchObject({ code: "INVALID_JOURNAL", problems: [{ code: "INVALID_AMOUNT", line: 1 }] });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("names the line whose account code does not exist", async () => {
    findAccounts.mockResolvedValue([{ id: ID, code: "7900" }]);
    const r = await create({
      date: "2026-12-01",
      memo: "Accrual",
      lines: [
        { accountCode: "7900", debit: "5.00" },
        { accountCode: "9999", credit: "5.00" },
      ],
    });
    expect(r).toMatchObject({ code: "INVALID_JOURNAL", problems: [{ code: "UNKNOWN_ACCOUNT", line: 2 }] });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("saves a draft unless asked to post, and accepts account codes and ISO dates", async () => {
    findAccounts.mockResolvedValue([{ id: ID, code: "7900" }]);
    transaction.mockRejectedValue(new AccountingError("STOP", "reached the service"));
    const r = await create({
      date: "2026-12-01T00:00:00.000Z",
      memo: "Accrual",
      lines: [
        { accountCode: "7900", debit: 5 },
        { accountId: ID, credit: "5.00" },
      ],
    });
    expect(r).toMatchObject({ code: "STOP" });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("tryCatchTool", () => {
  it("reports a broken rule of the books as the caller's to fix, with its message", async () => {
    const error = await tryCatchTool(async () => {
      throw new AccountingError("NOT_BALANCED", "They must agree to be matched", 422);
    }).catch((e) => e);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).message).toContain("They must agree to be matched (NOT_BALANCED)");
  });
});
