/**
 * Sales-side rules that are pure arithmetic or formatting: payment terms,
 * addresses, product codes and what a quantity times a price comes to.
 *
 * Kept free of Prisma and `next` imports so the invoice form can use exactly
 * the same rounding the server posts with — a total that changes when you
 * press Save is the fastest way to lose trust in a books module.
 */

import { MoneyError, type Pence } from "@/lib/money";

/** Quantities are integer thousandths: 0.5 day is 500, 2.5 days is 2500. */
export type Milli = number;

const QUANTITY_RE = /^([+-])?(\d+)(?:\.(\d*))?$/;

/** Units offered in the picker. Anything else can still be typed in. */
export const COMMON_UNITS = ["item", "day", "half-day", "hour", "week", "month", "licence"] as const;

export const MAX_PRODUCT_CODE_LENGTH = 24;

/** Codes are printed on invoices and matched on import: uppercase, no spaces. */
const PRODUCT_CODE_RE = /^[A-Z0-9][A-Z0-9._/-]*$/;

/** Trims, uppercases and squeezes inner whitespace out of a typed product code. */
export function normaliseProductCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/** Returns an error message, or null if the code is usable. */
export function validateProductCode(code: string): string | null {
  if (code.length === 0) return "A code is required";
  if (code.length > MAX_PRODUCT_CODE_LENGTH) {
    return `Codes are at most ${MAX_PRODUCT_CODE_LENGTH} characters`;
  }
  if (!PRODUCT_CODE_RE.test(code)) {
    return "Codes use capital letters, digits, and . _ / - (no spaces)";
  }
  return null;
}

/**
 * How the terms read on the invoice. Business Finance Assistant prints
 * "Due on receipt" for immediate payment and "At 30 days" otherwise, and the
 * business's customers are used to that wording.
 */
export function describePaymentTerms(days: number): string {
  if (!Number.isInteger(days) || days < 0) throw new MoneyError("Payment terms must be whole days");
  if (days === 0) return "Due on receipt";
  return `At ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Due date = issue date + terms, in whole calendar days.
 *
 * Takes and returns a ledger date (UTC midnight, see `toLedgerDate`), so it
 * cannot drift across a British Summer Time boundary the way local-midnight
 * arithmetic does.
 */
export function dueDateFrom(issueDate: Date, termsDays: number): Date {
  if (!Number.isInteger(termsDays) || termsDays < 0) {
    throw new MoneyError("Payment terms must be whole days");
  }
  const due = new Date(issueDate.getTime());
  due.setUTCDate(due.getUTCDate() + termsDays);
  return due;
}

/** Shipping defaults to billing — the usual case, and what INV023 prints. */
export function effectiveShippingAddress(contact: {
  billingAddress?: string | null;
  shippingAddress?: string | null;
}): string | null {
  const shipping = normaliseAddress(contact.shippingAddress);
  return shipping ?? normaliseAddress(contact.billingAddress);
}

/**
 * Tidies a pasted address: trims each line, drops blank and repeated-blank
 * lines. Returns null for an address that was only whitespace.
 */
export function normaliseAddress(value: string | null | undefined): string | null {
  if (value == null) return null;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Parses a quantity to integer thousandths, rounding half away from zero —
 * the same treatment `toPence` gives money, one decimal place further.
 *
 * Three decimals covers the real cases (half a day, a quarter of an hour) and
 * keeps quantity × price inside safe-integer range.
 */
export function toMilli(value: number | string): Milli {
  const str = typeof value === "number" ? String(value) : value.trim();
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new MoneyError("Quantity must be a finite number");
  }
  if (str.includes("e") || str.includes("E")) {
    throw new MoneyError("Quantity is outside the supported range");
  }

  const match = QUANTITY_RE.exec(str);
  if (!match) throw new MoneyError(`Not a valid quantity: ${JSON.stringify(str.slice(0, 32))}`);

  const [, sign, whole, fraction = ""] = match;
  const digits = (fraction + "0000").slice(0, 4);
  let milli = Number(whole) * 1000 + Number(digits.slice(0, 3));
  if (Number(digits[3]) >= 5) milli += 1;

  if (!Number.isSafeInteger(milli)) throw new MoneyError("Quantity is outside the supported range");
  if (milli === 0) return 0;
  return sign === "-" ? -milli : milli;
}

/** Integer thousandths → the shortest exact decimal: 500 → "0.5", 2500 → "2.5". */
export function fromMilli(milli: Milli): string {
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const fraction = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  const sign = milli < 0 ? "-" : "";
  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/**
 * Line amount = quantity × unit price, rounded half away from zero to the
 * penny. Done in integer milli-pence: 0.5 × £500.00 is exactly £250.00, and
 * 3 × £0.005 is 2p rather than the 1p that float multiplication gives.
 */
export function lineAmountPence(quantity: Milli, unitPrice: Pence): Pence {
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(unitPrice)) {
    throw new MoneyError("Quantity and price must be whole minor units");
  }
  const milliPence = quantity * unitPrice;
  if (!Number.isSafeInteger(milliPence)) throw new MoneyError("Line amount is outside the supported range");

  const abs = Math.abs(milliPence);
  const pence = Math.floor(abs / 1000) + (abs % 1000 >= 500 ? 1 : 0);
  if (!Number.isSafeInteger(pence)) throw new MoneyError("Line amount is outside the supported range");
  return milliPence < 0 ? -pence : pence;
}
