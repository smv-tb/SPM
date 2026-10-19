import { describe, it, expect } from "vitest";
import {
  calendarDateKey,
  financialYearContaining,
  isOnOrBeforeLockDate,
  isValidYearStart,
  ledgerDateKey,
  toLedgerDate,
} from "@/lib/accounting/dates";
import { AccountingError } from "@/lib/accounting/errors";

describe("toLedgerDate", () => {
  it("parses strict calendar dates to UTC midnight", () => {
    expect(toLedgerDate("2026-03-31").toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it.each(["2026-02-30", "2026-13-01", "31/03/2026", "2026-3-1", ""])("rejects %j", (input) => {
    expect(() => toLedgerDate(input)).toThrow(AccountingError);
  });

  it("drops the time of day from Date inputs using the UTC day", () => {
    expect(ledgerDateKey(toLedgerDate(new Date("2026-03-31T23:59:59Z")))).toBe("2026-03-31");
  });
});

describe("calendarDateKey", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // 00:30 local on 15 July: in BST the UTC day is still the 14th.
    expect(calendarDateKey(new Date(2026, 6, 15, 0, 30))).toBe("2026-07-15");
  });

  it("gives the London day for a moment just after midnight BST", () => {
    // 2026-07-14T23:30Z is 00:30 on the 15th in London.
    const justAfterMidnightInLondon = new Date("2026-07-14T23:30:00Z");
    expect(calendarDateKey(justAfterMidnightInLondon, "Europe/London")).toBe("2026-07-15");
    expect(calendarDateKey(justAfterMidnightInLondon, "UTC")).toBe("2026-07-14");
  });

  it("agrees with UTC in winter, when London is on GMT", () => {
    const winter = new Date("2026-01-14T23:30:00Z");
    expect(calendarDateKey(winter, "Europe/London")).toBe("2026-01-14");
  });

  it("produces a key toLedgerDate accepts", () => {
    const key = calendarDateKey(new Date(), "Europe/London");
    expect(ledgerDateKey(toLedgerDate(key))).toBe(key);
  });
});

describe("isOnOrBeforeLockDate", () => {
  it("treats the lock date itself as locked", () => {
    const lock = toLedgerDate("2026-03-31");
    expect(isOnOrBeforeLockDate(toLedgerDate("2026-03-31"), lock)).toBe(true);
    expect(isOnOrBeforeLockDate(toLedgerDate("2026-04-01"), lock)).toBe(false);
    expect(isOnOrBeforeLockDate(toLedgerDate("2020-01-01"), null)).toBe(false);
  });
});

describe("financialYearContaining", () => {
  it("handles dates either side of the year start", () => {
    const y1 = financialYearContaining(toLedgerDate("2026-03-31"), 4, 1);
    expect([ledgerDateKey(y1.start), ledgerDateKey(y1.end)]).toEqual(["2025-04-01", "2026-03-31"]);

    const y2 = financialYearContaining(toLedgerDate("2026-04-01"), 4, 1);
    expect([ledgerDateKey(y2.start), ledgerDateKey(y2.end)]).toEqual(["2026-04-01", "2027-03-31"]);
  });

  it("supports calendar years and mid-month starts, including leap years", () => {
    const cal = financialYearContaining(toLedgerDate("2028-02-29"), 1, 1);
    expect([ledgerDateKey(cal.start), ledgerDateKey(cal.end)]).toEqual(["2028-01-01", "2028-12-31"]);

    const mid = financialYearContaining(toLedgerDate("2027-03-10"), 3, 15);
    expect([ledgerDateKey(mid.start), ledgerDateKey(mid.end)]).toEqual(["2026-03-15", "2027-03-14"]);
  });

  it("rejects year starts that do not exist every year", () => {
    expect(isValidYearStart(2, 29)).toBe(false);
    expect(isValidYearStart(0, 1)).toBe(false);
    expect(() => financialYearContaining(new Date(), 2, 29)).toThrow(AccountingError);
  });
});
