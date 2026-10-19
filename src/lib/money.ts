/**
 * Money arithmetic for the books.
 *
 * Forecasting code elsewhere sums `Number(amount)` and lives with float drift;
 * a ledger cannot — a trial balance has to be exactly zero, not 1e-12. So every
 * amount that feeds accounting is converted to integer pence once, summed as
 * integers, and converted back to a 2dp string for Prisma `Decimal` columns.
 *
 * Integers are exact in a JS number up to 2^53 pence (~£90 trillion); every
 * result is checked against that bound rather than assumed.
 *
 * This module is dependency-free on purpose: it is imported by client
 * components (exports, forms) as well as the server, and must not pull
 * `@prisma/client` into the browser bundle.
 */

/** An amount in integer minor units (pence). */
export type Pence = number;

/** Anything that can hold a money value: form input, JSON, or a Prisma Decimal. */
export type MoneyInput = number | string | { toFixed(): string };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d*))?$/;

function assertSafe(pence: number): Pence {
  if (!Number.isSafeInteger(pence)) {
    throw new MoneyError("Amount is outside the supported range");
  }
  return pence;
}

function toPlainString(value: MoneyInput): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MoneyError("Amount must be a finite number");
    const str = String(value);
    if (!str.includes("e")) return str;
    // String() switches to exponent form below 1e-6 and at/above 1e21. The
    // former rounds to zero pence; the latter is out of range anyway.
    if (Math.abs(value) < 0.005) return "0";
    throw new MoneyError("Amount is outside the supported range");
  }
  if (typeof value === "string") return value.trim();
  // Prisma.Decimal (decimal.js): toFixed() with no argument never uses exponent form.
  return value.toFixed();
}

/**
 * Converts an amount to integer pence, rounding half away from zero to the
 * nearest penny.
 *
 * Numbers are read via their shortest decimal representation, so `1.005`
 * becomes 101p (as a person reading it expects) rather than 100p (as
 * `Math.round(1.005 * 100)` gives). Thousands separators and currency symbols
 * are rejected, not guessed — normalising imported text is the importer's job.
 */
export function toPence(value: MoneyInput): Pence {
  const str = toPlainString(value);
  const match = DECIMAL_RE.exec(str);
  if (!match) throw new MoneyError(`Not a valid amount: ${JSON.stringify(str.slice(0, 32))}`);

  const [, sign, whole, fraction = ""] = match;
  const digits = (fraction + "000").slice(0, 3);
  let pence = Number(whole) * 100 + Number(digits.slice(0, 2));
  // Only the third decimal decides half-up: anything after it can't move a
  // value across the .5 boundary once the third digit is known.
  if (Number(digits[2]) >= 5) pence += 1;

  assertSafe(pence);
  if (pence === 0) return 0;
  return sign === "-" ? -pence : pence;
}

/** Like `toPence`, but null/undefined (an unset optional amount) is zero. */
export function toPenceOrZero(value: MoneyInput | null | undefined): Pence {
  return value == null ? 0 : toPence(value);
}

/** Integer pence → "1234.56", the form Prisma `Decimal` columns accept exactly. */
export function fromPence(pence: Pence): string {
  assertSafe(pence);
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${pence < 0 ? "-" : ""}${pounds}.${rem}`;
}

export function sumPence(values: Iterable<Pence>): Pence {
  let total = 0;
  for (const v of values) total += v;
  return assertSafe(total);
}

/**
 * Splits `total` across `weights` so the parts always add back up to exactly
 * `total` — the largest-remainder method. Naively rounding each share loses or
 * invents pennies (£10 across three lines is 333 + 333 + 333 = 999p).
 *
 * Leftover pennies go to the shares with the largest fractional remainders;
 * ties go to the earlier share, so the result is deterministic.
 */
export function allocatePence(total: Pence, weights: number[]): Pence[] {
  assertSafe(total);
  if (weights.length === 0) throw new MoneyError("Cannot allocate across zero shares");
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError("Allocation weights must be finite and non-negative");
  }
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) throw new MoneyError("Allocation weights must not all be zero");

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const shares = weights.map((w, index) => {
    const exact = (abs * w) / weightSum;
    const floor = Math.floor(exact);
    return { index, floor, remainder: exact - floor };
  });

  let leftover = abs - shares.reduce((s, x) => s + x.floor, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const share of byRemainder) {
    if (leftover <= 0) break;
    share.floor += 1;
    leftover -= 1;
  }

  return shares.map((s) => (s.floor === 0 ? 0 : sign * s.floor));
}

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function formatPence(pence: Pence): string {
  return GBP.format(pence / 100);
}
