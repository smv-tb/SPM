/**
 * Chart of accounts: types, code ranges and the default UK small-company
 * template. The template is seeded by the general-ledger migration; a unit
 * test reads that migration to keep the two from drifting.
 */

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** The side on which an account normally carries its balance. */
export const NORMAL_BALANCE: Record<AccountType, "DEBIT" | "CREDIT"> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  INCOME: "CREDIT",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
};

/**
 * Codes are four digits and grouped by type, so reports order predictably and
 * a code alone tells an accountant roughly what an account is.
 */
export const CODE_RANGES: Record<AccountType, readonly [number, number]> = {
  ASSET: [1000, 1999],
  LIABILITY: [2000, 2999],
  EQUITY: [3000, 3999],
  INCOME: [4000, 4999],
  EXPENSE: [5000, 9999],
};

/** Returns an error message, or null if the code suits the type. */
export function validateAccountCode(code: string, type: AccountType): string | null {
  if (!/^\d{4}$/.test(code)) return "Account codes are four digits";
  const [min, max] = CODE_RANGES[type];
  const n = Number(code);
  if (n < min || n > max) {
    return `${ACCOUNT_TYPE_LABEL[type]} accounts use codes ${min}–${max}`;
  }
  return null;
}

export interface TemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  isSystem: boolean;
}

/**
 * Accounts automated postings refer to by code (funding receipts, opening
 * balances, reversals, year-end). These can be renamed but not archived,
 * retyped or recoded.
 */
export const SYSTEM_ACCOUNT_CODES = {
  TRADE_DEBTORS: "1100",
  BANK: "1200",
  TRADE_CREDITORS: "2100",
  VAT: "2200",
  LOANS: "2300",
  DIRECTORS_LOAN: "2400",
  DEFERRED_INCOME: "2500",
  SUSPENSE: "2999",
  SHARE_CAPITAL: "3000",
  RETAINED_EARNINGS: "3100",
  OPENING_BALANCE_ADJUSTMENTS: "3900",
  SALES: "4000",
  GRANT_INCOME: "4900",
} as const;

const SYSTEM_CODES = new Set<string>(Object.values(SYSTEM_ACCOUNT_CODES));

const sys = (code: string, name: string, type: AccountType): TemplateAccount => ({
  code,
  name,
  type,
  isSystem: SYSTEM_CODES.has(code),
});

export const DEFAULT_CHART: readonly TemplateAccount[] = [
  sys("1000", "Office equipment", "ASSET"),
  sys("1010", "Office equipment depreciation", "ASSET"),
  sys("1100", "Trade debtors", "ASSET"),
  sys("1150", "Prepayments", "ASSET"),
  sys("1200", "Business bank account", "ASSET"),
  sys("1210", "Savings account", "ASSET"),
  sys("1300", "Other debtors", "ASSET"),
  sys("2100", "Trade creditors", "LIABILITY"),
  sys("2110", "Other creditors", "LIABILITY"),
  sys("2150", "Accruals", "LIABILITY"),
  sys("2200", "VAT", "LIABILITY"),
  sys("2210", "PAYE and NIC", "LIABILITY"),
  sys("2220", "Corporation tax", "LIABILITY"),
  sys("2300", "Loans", "LIABILITY"),
  sys("2400", "Director's loan account", "LIABILITY"),
  sys("2500", "Deferred grant income", "LIABILITY"),
  sys("2999", "Suspense", "LIABILITY"),
  sys("3000", "Share capital", "EQUITY"),
  sys("3100", "Retained earnings", "EQUITY"),
  sys("3900", "Opening balance adjustments", "EQUITY"),
  sys("4000", "Sales", "INCOME"),
  sys("4100", "Other income", "INCOME"),
  sys("4900", "Grant income", "INCOME"),
  sys("5000", "Cost of sales", "EXPENSE"),
  sys("5100", "Subcontractors", "EXPENSE"),
  sys("6000", "Salaries", "EXPENSE"),
  sys("6010", "Employer's NIC", "EXPENSE"),
  sys("6020", "Pension contributions", "EXPENSE"),
  sys("6100", "Rent and rates", "EXPENSE"),
  sys("6200", "Utilities", "EXPENSE"),
  sys("6300", "Travel", "EXPENSE"),
  sys("6400", "Software and subscriptions", "EXPENSE"),
  sys("6500", "Professional fees", "EXPENSE"),
  sys("6510", "Accountancy fees", "EXPENSE"),
  sys("6600", "Marketing", "EXPENSE"),
  sys("6700", "Bank charges", "EXPENSE"),
  sys("6800", "Insurance", "EXPENSE"),
  sys("6900", "Telephone and internet", "EXPENSE"),
  sys("7000", "Research and development", "EXPENSE"),
  sys("7100", "Equipment (expensed)", "EXPENSE"),
  sys("7200", "Training", "EXPENSE"),
  sys("7500", "Depreciation", "EXPENSE"),
  sys("7900", "General expenses", "EXPENSE"),
  sys("8000", "Interest paid", "EXPENSE"),
];
