import { describe, it, expect } from "vitest";
import { toLedgerDate, ledgerDateKey } from "@/lib/accounting/dates";
import {
  describePaymentTerms,
  dueDateFrom,
  effectiveShippingAddress,
  fromMilli,
  lineAmountPence,
  normaliseAddress,
  normaliseProductCode,
  toMilli,
  validateProductCode,
} from "@/lib/accounting/sales";
import { MoneyError, toPence } from "@/lib/money";

describe("product codes", () => {
  it("uppercases and strips spaces", () => {
    expect(normaliseProductCode("  smv 0002 ")).toBe("SMV0002");
  });

  it.each(["SMV0002", "BI-CONSULT", "A1", "TRAIN/DAY", "X._-1"])("accepts %s", (code) => {
    expect(validateProductCode(code)).toBeNull();
  });

  it.each(["", "smv0002", "-LEAD", "HAS SPACE", "£100", "A".repeat(25)])("rejects %j", (code) => {
    expect(validateProductCode(code)).not.toBeNull();
  });
});

describe("describePaymentTerms", () => {
  it("prints 0 days as due on receipt, as INV023 does", () => {
    expect(describePaymentTerms(0)).toBe("Due on receipt");
  });

  it("prints a day count, singular at 1", () => {
    expect(describePaymentTerms(1)).toBe("At 1 day");
    expect(describePaymentTerms(30)).toBe("At 30 days");
  });

  it.each([-1, 1.5])("rejects %j", (days) => {
    expect(() => describePaymentTerms(days)).toThrow(MoneyError);
  });
});

describe("dueDateFrom", () => {
  it("adds whole days", () => {
    expect(ledgerDateKey(dueDateFrom(toLedgerDate("2026-05-26"), 30))).toBe("2026-06-25");
  });

  it("is the issue date when payment is due on receipt", () => {
    expect(ledgerDateKey(dueDateFrom(toLedgerDate("2026-08-23"), 0))).toBe("2026-08-23");
  });

  it("does not shift across the end of British Summer Time", () => {
    // 25 October 2026 is the clock change; local-midnight arithmetic lands on
    // the 24th at 23:00 and reads back as the wrong day.
    expect(ledgerDateKey(dueDateFrom(toLedgerDate("2026-10-24"), 1))).toBe("2026-10-25");
    expect(ledgerDateKey(dueDateFrom(toLedgerDate("2026-10-01"), 31))).toBe("2026-11-01");
  });

  it("leaves the issue date untouched", () => {
    const issue = toLedgerDate("2026-08-23");
    dueDateFrom(issue, 14);
    expect(ledgerDateKey(issue)).toBe("2026-08-23");
  });
});

describe("addresses", () => {
  it("trims lines and drops blank ones", () => {
    expect(normaliseAddress("  Acme Frank \n\n 2 Mill Lane \n\n")).toBe(
      "Acme Frank\n2 Mill Lane"
    );
  });

  it("treats a whitespace-only address as absent", () => {
    expect(normaliseAddress("   \n  ")).toBeNull();
    expect(normaliseAddress(null)).toBeNull();
  });

  it("falls back to the billing address for shipping", () => {
    const contact = { billingAddress: "Acme Frank\nAB1 2CD", shippingAddress: null };
    expect(effectiveShippingAddress(contact)).toBe("Acme Frank\nAB1 2CD");
  });

  it("uses a separate shipping address when there is one", () => {
    expect(
      effectiveShippingAddress({ billingAddress: "Head office", shippingAddress: "Site gate" })
    ).toBe("Site gate");
  });
});

describe("quantities", () => {
  it.each([
    ["0.5", 500],
    ["2.5", 2500],
    [1, 1000],
    ["0.25", 250],
    ["10", 10000],
    ["0.0004", 0],
    ["1.0005", 1001],
  ])("reads %j as %i thousandths", (input, expected) => {
    expect(toMilli(input as string | number)).toBe(expected);
  });

  it.each(["", "1.2.3", "£2", "2,5", "abc", "1e3"])("rejects %j", (input) => {
    expect(() => toMilli(input)).toThrow(MoneyError);
  });

  it("round-trips through the shortest decimal", () => {
    expect(fromMilli(500)).toBe("0.5");
    expect(fromMilli(2500)).toBe("2.5");
    expect(fromMilli(1000)).toBe("1");
    expect(fromMilli(1250)).toBe("1.25");
    expect(fromMilli(-500)).toBe("-0.5");
  });
});

describe("lineAmountPence", () => {
  it("prices INV023's line exactly: 0.5 days at £500.00", () => {
    expect(lineAmountPence(toMilli("0.5"), toPence("500.00"))).toBe(25_000);
  });

  it("prices INV018's line: 2.5 days at £500.00", () => {
    expect(lineAmountPence(toMilli("2.5"), toPence("500.00"))).toBe(125_000);
  });

  it("rounds half away from zero at the penny", () => {
    // 1.5 × 1p is 1.5p: a person rounds that up, `Math.round` on the float
    // product does too, but 2.5 × 3p = 7.5p is where float rounding slips.
    expect(lineAmountPence(toMilli("1.5"), 1)).toBe(2);
    expect(lineAmountPence(toMilli("2.5"), 3)).toBe(8);
    expect(lineAmountPence(toMilli("0.333"), 1)).toBe(0);
    expect(lineAmountPence(toMilli("0.333"), toPence("100.00"))).toBe(3330);
  });

  it("is zero for a zero quantity or a free line", () => {
    expect(lineAmountPence(0, toPence("500.00"))).toBe(0);
    expect(lineAmountPence(toMilli("2"), 0)).toBe(0);
  });

  it("keeps the sign of a credit quantity", () => {
    expect(lineAmountPence(toMilli("-0.5"), toPence("500.00"))).toBe(-25_000);
  });

  it("refuses amounts that would leave exact integer range", () => {
    expect(() => lineAmountPence(toMilli("999999999"), toPence("999999999.99"))).toThrow(MoneyError);
  });
});
