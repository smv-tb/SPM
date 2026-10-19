import { describe, it, expect } from "vitest";
import {
  toPence,
  toPenceOrZero,
  fromPence,
  sumPence,
  allocatePence,
  formatPence,
  MoneyError,
} from "@/lib/money";

describe("toPence", () => {
  it("parses plain decimal strings exactly", () => {
    expect(toPence("12.34")).toBe(1234);
    expect(toPence("12")).toBe(1200);
    expect(toPence("12.")).toBe(1200);
    expect(toPence("0.5")).toBe(50);
    expect(toPence(" -7.01 ")).toBe(-701);
    expect(toPence("+3.00")).toBe(300);
  });

  it("does not inherit float drift from number inputs", () => {
    expect(toPence(0.1 + 0.2)).toBe(30);
    expect(toPence(19.99 * 3)).toBe(5997);
  });

  it("rounds half away from zero using the written value, not the float", () => {
    // Math.round(1.005 * 100) === 100 — the bug this module exists to avoid.
    expect(toPence(1.005)).toBe(101);
    expect(toPence("2.345")).toBe(235);
    expect(toPence("-2.345")).toBe(-235);
    expect(toPence("1.0049")).toBe(100);
  });

  it("accepts Decimal-like objects via toFixed()", () => {
    const decimal = { toFixed: () => "1500.25" };
    expect(toPence(decimal)).toBe(150025);
  });

  it("normalises negative zero", () => {
    expect(Object.is(toPence("-0.001"), 0)).toBe(true);
  });

  it("treats tiny exponent-form numbers as zero", () => {
    expect(toPence(1e-7)).toBe(0);
  });

  it.each(["", "abc", "1,234.56", "£12", "1e5", "12.3.4", "--1"])("rejects %j", (input) => {
    expect(() => toPence(input)).toThrow(MoneyError);
  });

  it("rejects non-finite and out-of-range numbers", () => {
    expect(() => toPence(Number.NaN)).toThrow(MoneyError);
    expect(() => toPence(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => toPence(1e21)).toThrow(MoneyError);
    expect(() => toPence("900000000000000000")).toThrow(MoneyError);
  });
});

describe("toPenceOrZero", () => {
  it("maps unset amounts to zero", () => {
    expect(toPenceOrZero(null)).toBe(0);
    expect(toPenceOrZero(undefined)).toBe(0);
    expect(toPenceOrZero("4.20")).toBe(420);
  });
});

describe("fromPence", () => {
  it("formats as a 2dp decimal string", () => {
    expect(fromPence(123456)).toBe("1234.56");
    expect(fromPence(5)).toBe("0.05");
    expect(fromPence(-5)).toBe("-0.05");
    expect(fromPence(0)).toBe("0.00");
  });

  it("round-trips with toPence", () => {
    for (const p of [0, 1, -1, 99, 100, 123456789, -987654321]) {
      expect(toPence(fromPence(p))).toBe(p);
    }
  });

  it("rejects non-integer pence", () => {
    expect(() => fromPence(1.5)).toThrow(MoneyError);
  });
});

describe("sumPence", () => {
  it("sums exactly", () => {
    expect(sumPence([10, 20, -5])).toBe(25);
    expect(sumPence([])).toBe(0);
  });
});

describe("allocatePence", () => {
  it("never loses or invents a penny", () => {
    const parts = allocatePence(1000, [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(sumPence(parts)).toBe(1000);
  });

  it("splits proportionally", () => {
    expect(allocatePence(10000, [3, 1])).toEqual([7500, 2500]);
  });

  it("handles negative totals symmetrically", () => {
    expect(allocatePence(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
  });

  it("gives zero-weight shares nothing", () => {
    expect(allocatePence(501, [0, 1, 1])).toEqual([0, 251, 250]);
  });

  it("always sums to the total for awkward weights", () => {
    const weights = [0.137, 2.9, 11, 0.0004, 7.77];
    for (const total of [1, 7, 999, 123457, -31]) {
      expect(sumPence(allocatePence(total, weights))).toBe(total);
    }
  });

  it("rejects invalid weights", () => {
    expect(() => allocatePence(100, [])).toThrow(MoneyError);
    expect(() => allocatePence(100, [0, 0])).toThrow(MoneyError);
    expect(() => allocatePence(100, [1, -1])).toThrow(MoneyError);
  });
});

describe("formatPence", () => {
  it("formats as GBP", () => {
    expect(formatPence(123456)).toBe("£1,234.56");
    expect(formatPence(-50)).toBe("-£0.50");
  });
});
