import { describe, it, expect } from "vitest";
import {
  allocateJournalNumber,
  journalTotals,
  reverseLines,
  validateJournal,
  type AccountRef,
} from "@/lib/accounting/journal";
import { toLedgerDate } from "@/lib/accounting/dates";
import { AccountingError } from "@/lib/accounting/errors";

const accounts = new Map<string, AccountRef>([
  ["bank", { id: "bank", code: "1200", name: "Bank", isArchived: false }],
  ["grant", { id: "grant", code: "4900", name: "Grant income", isArchived: false }],
  ["old", { id: "old", code: "6999", name: "Old expenses", isArchived: true }],
]);

const date = toLedgerDate("2026-05-10");
const balanced = [
  { accountId: "bank", debit: 50000, credit: 0 },
  { accountId: "grant", debit: 0, credit: 50000 },
];

const post = (lines = balanced, lockDate: Date | null = null) =>
  validateJournal({ date, lines }, { lockDate, accounts, mode: "post" });
const codes = (problems: { code: string }[]) => problems.map((p) => p.code);

describe("validateJournal (post)", () => {
  it("accepts a balanced two-line journal", () => {
    expect(post()).toEqual([]);
  });

  it("rejects unbalanced journals", () => {
    const problems = post([balanced[0], { accountId: "grant", debit: 0, credit: 49999 }]);
    expect(codes(problems)).toEqual(["UNBALANCED"]);
    expect(problems[0].message).toContain("£500.00");
  });

  it("requires at least two lines", () => {
    expect(codes(post([balanced[0]]))).toContain("TOO_FEW_LINES");
  });

  it("rejects dates on or before the lock date, but not after", () => {
    expect(codes(post(balanced, toLedgerDate("2026-05-10")))).toEqual(["LOCKED_PERIOD"]);
    expect(codes(post(balanced, toLedgerDate("2026-06-01")))).toEqual(["LOCKED_PERIOD"]);
    expect(post(balanced, toLedgerDate("2026-05-09"))).toEqual([]);
  });

  it("flags line-level problems with their line number", () => {
    const problems = post([
      { accountId: "bank", debit: 100, credit: 100 },
      { accountId: "grant", debit: 0, credit: 0 },
      { accountId: "missing", debit: 0, credit: 100 },
      { accountId: "old", debit: 100, credit: 0 },
    ]);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BOTH_SIDES", line: 1 }),
        expect.objectContaining({ code: "ZERO_LINE", line: 2 }),
        expect.objectContaining({ code: "UNKNOWN_ACCOUNT", line: 3 }),
        expect.objectContaining({ code: "ARCHIVED_ACCOUNT", line: 4 }),
      ])
    );
  });

  it("does not try to total invalid amounts", () => {
    const problems = post([
      { accountId: "bank", debit: 1.5, credit: 0 },
      { accountId: "grant", debit: 0, credit: -3 },
    ]);
    expect(codes(problems)).toEqual(["INVALID_AMOUNT", "NEGATIVE_AMOUNT"]);
  });
});

describe("validateJournal (draft)", () => {
  it("allows work-in-progress drafts that are unbalanced, short, or in a locked period", () => {
    const problems = validateJournal(
      { date, lines: [balanced[0]] },
      { lockDate: toLedgerDate("2026-12-31"), accounts, mode: "draft" }
    );
    expect(problems).toEqual([]);
  });

  it("still rejects malformed lines and bad accounts", () => {
    const problems = validateJournal(
      { date, lines: [{ accountId: "old", debit: -1, credit: 0 }] },
      { lockDate: null, accounts, mode: "draft" }
    );
    expect(codes(problems)).toEqual(["NEGATIVE_AMOUNT", "ARCHIVED_ACCOUNT"]);
  });
});

describe("allocateJournalNumber", () => {
  it("uses the counter when the ledger agrees with it", () => {
    expect(allocateJournalNumber(1, null)).toBe(1);
    expect(allocateJournalNumber(7, 6)).toBe(7);
  });

  it("skips past numbers that already exist", () => {
    // e.g. an opening-balance import wrote #1 and #2 without moving the counter.
    expect(allocateJournalNumber(1, 2)).toBe(3);
  });

  it("never goes backwards when the counter is ahead", () => {
    expect(allocateJournalNumber(10, 2)).toBe(10);
  });

  it("clamps a counter that has fallen below the start of the sequence", () => {
    expect(allocateJournalNumber(0, null)).toBe(1);
  });

  it("rejects a counter that is not a whole number, or numbering that has overflowed", () => {
    expect(() => allocateJournalNumber(1.5, null)).toThrow(AccountingError);
    expect(() => allocateJournalNumber(1, Number.MAX_SAFE_INTEGER)).toThrow(AccountingError);
  });
});

describe("journalTotals / reverseLines", () => {
  it("totals and reverses exactly", () => {
    expect(journalTotals(balanced)).toEqual({ debit: 50000, credit: 50000, difference: 0 });
    const reversed = reverseLines(balanced);
    expect(reversed).toEqual([
      { accountId: "bank", debit: 0, credit: 50000 },
      { accountId: "grant", debit: 50000, credit: 0 },
    ]);
    // A journal plus its reversal nets every account to zero.
    const net = new Map<string, number>();
    for (const l of [...balanced, ...reversed]) net.set(l.accountId, (net.get(l.accountId) ?? 0) + l.debit - l.credit);
    expect([...net.values()]).toEqual([0, 0]);
  });
});
