import { describe, it, expect, vi, beforeEach } from "vitest";

const transaction = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (...a: unknown[]) => transaction(...a) } }));

import { registerTaskTools } from "@/hermes/tools/tasks";
import { MAX_BULK_ITEMS } from "@/hermes/tools/_shared";

const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
registerTaskTools(handlers);
const bulk = (args: Record<string, unknown>) => handlers.get("task_bulk_update")!(args) as Promise<Record<string, unknown>>;

beforeEach(() => transaction.mockReset());

describe("task_bulk_update validates before it writes", () => {
  it("asks for updates, or ids plus set", async () => {
    expect(await bulk({})).toEqual({ error: "Provide either `updates` or both `ids` and `set`" });
    expect(await bulk({ ids: ["a"] })).toMatchObject({ error: expect.stringContaining("ids") });
  });

  it("treats an empty batch as a no-op", async () => {
    expect(await bulk({ updates: [] })).toEqual({ updated: 0, results: [] });
    expect(transaction).not.toHaveBeenCalled();
  });

  it(`refuses more than ${MAX_BULK_ITEMS} items`, async () => {
    const ids = Array.from({ length: MAX_BULK_ITEMS + 1 }, (_, i) => `t${i}`);
    const r = await bulk({ ids, set: { status: "DONE" } });
    expect(r.error).toContain("Too many items");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("accepts exactly the cap", async () => {
    transaction.mockResolvedValue([]);
    const ids = Array.from({ length: MAX_BULK_ITEMS }, (_, i) => `t${i}`);
    const r = await bulk({ ids, set: { status: "DONE" } });
    expect(r.error).toBeUndefined();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("reports every bad item and writes nothing", async () => {
    const r = await bulk({
      updates: [
        { id: "a", status: "DONE" },
        { id: "a", status: "BACKLOG" },
        { status: "DONE" },
        { id: "b", status: "NOT_A_STATUS" },
      ],
    });
    expect(r.error).toBe("Validation failed; nothing was written");
    const errors = r.errors as { index: number; error: unknown }[];
    expect(errors.map((e) => e.index)).toEqual([1, 2, 3]);
    expect(errors[0].error).toBe("duplicate id in this batch");
    expect(errors[1].error).toBe("id is required");
    expect(transaction).not.toHaveBeenCalled();
  });
});
