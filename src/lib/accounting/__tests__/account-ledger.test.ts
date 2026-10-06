import { describe, it, expect } from "vitest";
import { buildAccountLedger, type LedgerMovement } from "@/lib/accounting/account-ledger";
import { sumPence } from "@/lib/money";

/** 250 lines with awkward pence, so any float or truncation error shows. */
const all: LedgerMovement[] = Array.from({ length: 250 }, (_, i) =>
  i % 3 === 0 ? { debit: 1000 + i * 7 + 1, credit: 0 } : { debit: 0, credit: 300 + i * 3 + 2 }
);
const net = (lines: LedgerMovement[]) => sumPence(lines.flatMap((l) => [l.debit, -l.credit]));
const totals = {
  windowDebit: sumPence(all.map((l) => l.debit)),
  windowCredit: sumPence(all.map((l) => l.credit)),
  total: all.length,
};
const page = (offset: number, limit: number, openingBalance = 5000) =>
  buildAccountLedger({
    openingBalance,
    ...totals,
    carriedIn: net(all.slice(0, offset)),
    lines: all.slice(offset, offset + limit),
    offset,
    limit,
  });

describe("buildAccountLedger", () => {
  it("closes on the balance after ALL lines, not after the page shown", () => {
    const first = page(0, 100);
    const expected = 5000 + net(all);
    expect(first.closingBalance).toBe(expected);
    // The old behaviour: the balance after the last row shown.
    expect(first.rows.at(-1)!.balance).not.toBe(expected);
    expect(first.truncated).toBe(true);
    expect(first.nextOffset).toBe(100);
  });

  it("gives the same closing balance for every page size and position", () => {
    const expected = 5000 + net(all);
    for (const [offset, limit] of [[0, 1], [0, 100], [100, 100], [200, 100], [249, 5], [0, 1000]]) {
      expect(page(offset, limit).closingBalance).toBe(expected);
    }
  });

  it("starts a later page from the balance carried in", () => {
    const second = page(100, 100);
    expect(second.pageOpeningBalance).toBe(5000 + net(all.slice(0, 100)));
    expect(second.rows[0].balance).toBe(second.pageOpeningBalance + all[100].debit - all[100].credit);
  });

  it("makes paged running balances identical to one unpaged run", () => {
    const whole = page(0, 1000).rows.map((r) => r.balance);
    const stitched = [page(0, 100), page(100, 100), page(200, 100)].flatMap((p) => p.rows.map((r) => r.balance));
    expect(stitched).toEqual(whole);
  });

  it("reports the last page as complete", () => {
    const last = page(200, 100);
    expect(last.rows).toHaveLength(50);
    expect(last.truncated).toBe(false);
    expect(last.nextOffset).toBeNull();
  });

  it("handles an empty window", () => {
    const empty = buildAccountLedger({
      openingBalance: 1234, windowDebit: 0, windowCredit: 0, total: 0, carriedIn: 0, lines: [], offset: 0, limit: 100,
    });
    expect(empty).toMatchObject({ closingBalance: 1234, rows: [], truncated: false });
  });
});
