import { describe, it, expect } from "vitest";
import {
  accountCreateSchema,
  accountUpdateSchema,
  companySettingsSchema,
  journalSchema,
  lockDateSchema,
} from "@/schemas/books";

const account = "11111111-1111-4111-8111-111111111111";

describe("journalSchema", () => {
  const valid = {
    date: "2026-05-10",
    memo: "Grant received",
    lines: [
      { accountId: account, debit: "500.00" },
      { accountId: account, credit: "500.00" },
    ],
  };

  it("accepts a journal and defaults to saving a draft", () => {
    const parsed = journalSchema.parse(valid);
    expect(parsed.post).toBe(false);
  });

  it("keeps amounts as written rather than coercing them to floats", () => {
    const parsed = journalSchema.parse({ ...valid, lines: [{ accountId: account, debit: "1.005" }] });
    expect(parsed.lines[0].debit).toBe("1.005");
  });

  it.each([
    ["10/05/2026", "a non-ISO date"],
    ["2026-5-10", "an unpadded date"],
  ])("rejects %s (%s)", (date) => {
    expect(journalSchema.safeParse({ ...valid, date }).success).toBe(false);
  });

  it("requires a description and at least one line", () => {
    expect(journalSchema.safeParse({ ...valid, memo: "" }).success).toBe(false);
    expect(journalSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
  });

  it("rejects an account id that is not a uuid", () => {
    expect(journalSchema.safeParse({ ...valid, lines: [{ accountId: "1200", debit: 1 }] }).success).toBe(false);
  });
});

describe("accountCreateSchema", () => {
  it("requires a four-digit code", () => {
    expect(accountCreateSchema.safeParse({ code: "6100", name: "Rent", type: "EXPENSE" }).success).toBe(true);
    expect(accountCreateSchema.safeParse({ code: "610", name: "Rent", type: "EXPENSE" }).success).toBe(false);
    expect(accountCreateSchema.safeParse({ code: "6100", name: "Rent", type: "WRONG" }).success).toBe(false);
  });
});

describe("accountUpdateSchema", () => {
  it("rejects an empty update", () => {
    expect(accountUpdateSchema.safeParse({}).success).toBe(false);
    expect(accountUpdateSchema.safeParse({ name: "Rent and rates" }).success).toBe(true);
  });
});

describe("companySettingsSchema", () => {
  it("caps the financial year start at day 28", () => {
    expect(companySettingsSchema.safeParse({ yearStartDay: 28 }).success).toBe(true);
    expect(companySettingsSchema.safeParse({ yearStartDay: 29 }).success).toBe(false);
    expect(companySettingsSchema.safeParse({ yearStartMonth: 13 }).success).toBe(false);
  });

  it("requires a three-letter currency", () => {
    expect(companySettingsSchema.safeParse({ baseCurrency: "GBP" }).success).toBe(true);
    expect(companySettingsSchema.safeParse({ baseCurrency: "Pounds" }).success).toBe(false);
  });
});

describe("lockDateSchema", () => {
  it("accepts a date or null, with an optional reason", () => {
    expect(lockDateSchema.safeParse({ lockDate: "2026-03-31" }).success).toBe(true);
    expect(lockDateSchema.safeParse({ lockDate: null, reason: "Adjustment from accountant" }).success).toBe(true);
    expect(lockDateSchema.safeParse({ lockDate: "31-03-2026" }).success).toBe(false);
  });
});
