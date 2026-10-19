/**
 * The balance sheet as a pure calculation over posted movements.
 *
 * Laid out the way the business is used to reading it (Business Finance
 * Assistant's report): assets grouped into fixed assets, bank, trade debtors
 * and other current assets; liabilities into current and loans; equity, with
 * the profit or loss not yet closed into retained earnings shown on its own
 * lines — brought forward from earlier years, and for the year so far — until
 * year-end close (Phase 9) does that properly.
 *
 * The result is a flat list of rows with one amount per column, so the
 * screen, the CSV and the PDF all print the same thing, and a comparative
 * date is just a second column.
 */

import { sumPence, type Pence } from "@/lib/money";
import type { AccountType } from "./chart";
import type { AccountMovement, ReportAccount } from "./trial-balance";

export interface BalanceSheetDetail {
  key: string;
  label: string;
  amount: Pence;
}

export interface BalanceSheetLine {
  /** Account id, or a fixed key for the computed earnings lines. */
  key: string;
  code: string | null;
  label: string;
  amount: Pence;
  /** Optional breakdown printed under the line (trade debtors by customer). */
  detail?: BalanceSheetDetail[];
}

export interface BalanceSheetGroup {
  key: string;
  title: string;
  lines: BalanceSheetLine[];
  total: Pence;
}

export interface BalanceSheetSection {
  key: "assets" | "liabilities" | "equity";
  title: string;
  groups: BalanceSheetGroup[];
  total: Pence;
}

export interface BalanceSheet {
  asAt: string;
  yearStart: string;
  sections: BalanceSheetSection[];
  totalAssets: Pence;
  totalLiabilitiesAndEquity: Pence;
  /** Always true for posted data; reported, never assumed. */
  balanced: boolean;
}

/** Which group an account belongs in, by type and code range. */
export function groupFor(type: AccountType, code: string): { section: BalanceSheetSection["key"]; group: string } | null {
  const n = Number(code);
  switch (type) {
    case "ASSET":
      if (n < 1100) return { section: "assets", group: "fixed" };
      if (n < 1150) return { section: "assets", group: "debtors" };
      if (n >= 1200 && n < 1300) return { section: "assets", group: "bank" };
      return { section: "assets", group: "otherCurrent" };
    case "LIABILITY":
      if (n >= 2300 && n < 2400) return { section: "liabilities", group: "loans" };
      return { section: "liabilities", group: "current" };
    case "EQUITY":
      return { section: "equity", group: "capital" };
    default:
      return null; // income and expense: summed into earnings
  }
}

const GROUPS: Record<BalanceSheetSection["key"], { key: string; title: string }[]> = {
  assets: [
    { key: "bank", title: "Bank" },
    { key: "debtors", title: "Trade debtors" },
    { key: "otherCurrent", title: "Other current assets" },
    { key: "fixed", title: "Fixed assets" },
  ],
  liabilities: [
    { key: "current", title: "Current liabilities" },
    { key: "loans", title: "Loans" },
  ],
  equity: [
    { key: "capital", title: "Capital and reserves" },
    { key: "earnings", title: "Profit and loss" },
  ],
};

const SECTION_TITLE: Record<BalanceSheetSection["key"], string> = {
  assets: "Assets",
  liabilities: "Liabilities",
  equity: "Equity",
};

/** An account's balance on its natural side: assets debit, the rest credit. */
function natural(type: AccountType, m: AccountMovement | undefined): Pence {
  if (!m) return 0;
  return type === "ASSET" || type === "EXPENSE" ? m.debit - m.credit : m.credit - m.debit;
}

/** Income less expenses over a set of movements. */
export function profit(accounts: ReportAccount[], movements: AccountMovement[]): Pence {
  const byId = new Map(movements.map((m) => [m.accountId, m]));
  return sumPence(
    accounts.map((a) =>
      a.type === "INCOME" ? natural("INCOME", byId.get(a.id)) : a.type === "EXPENSE" ? -natural("EXPENSE", byId.get(a.id)) : 0
    )
  );
}

export function buildBalanceSheet(input: {
  asAt: string;
  yearStart: string;
  accounts: ReportAccount[];
  /** Posted movements dated on or before the report date. */
  toDate: AccountMovement[];
  /** Posted movements dated before the financial year starts. */
  beforeYear: AccountMovement[];
  /** Breakdown of the trade debtors line by customer, keyed by account code. */
  details?: Record<string, BalanceSheetDetail[]>;
}): BalanceSheet {
  const byId = new Map(input.toDate.map((m) => [m.accountId, m]));
  const grouped = new Map<string, BalanceSheetLine[]>();

  for (const account of [...input.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const place = groupFor(account.type, account.code);
    if (!place) continue;
    const key = `${place.section}:${place.group}`;
    grouped.set(key, [
      ...(grouped.get(key) ?? []),
      {
        key: account.id,
        code: account.code,
        label: account.name,
        amount: natural(account.type, byId.get(account.id)),
        ...(input.details?.[account.code] ? { detail: input.details[account.code] } : {}),
      },
    ]);
  }

  // Earnings not yet closed into retained earnings.
  const broughtForward = profit(input.accounts, input.beforeYear);
  const forYear = profit(input.accounts, input.toDate) - broughtForward;
  grouped.set("equity:earnings", [
    { key: "earnings:broughtForward", code: null, label: "Profit or loss brought forward", amount: broughtForward },
    { key: "earnings:year", code: null, label: "Profit or loss for the year", amount: forYear },
  ]);

  const sections: BalanceSheetSection[] = (["assets", "liabilities", "equity"] as const).map((section) => {
    const groups = GROUPS[section].map(({ key, title }) => {
      const lines = grouped.get(`${section}:${key}`) ?? [];
      return { key, title, lines, total: sumPence(lines.map((l) => l.amount)) };
    });
    return { key: section, title: SECTION_TITLE[section], groups, total: sumPence(groups.map((g) => g.total)) };
  });

  const totalAssets = sections[0].total;
  const totalLiabilitiesAndEquity = sections[1].total + sections[2].total;
  return {
    asAt: input.asAt,
    yearStart: input.yearStart,
    sections,
    totalAssets,
    totalLiabilitiesAndEquity,
    balanced: totalAssets === totalLiabilitiesAndEquity,
  };
}

// ── Rows for printing ───────────────────────────────────────────────────────

export type ReportRowKind = "section" | "group" | "line" | "detail" | "groupTotal" | "sectionTotal" | "grandTotal";

export interface ReportRow {
  kind: ReportRowKind;
  label: string;
  code: string | null;
  /** One per column; null on headings. */
  amounts: (Pence | null)[];
}

/**
 * One or more balance sheets (the report date, then any comparative) as rows
 * aligned by line. A line or group that is zero in every column is left out
 * unless `includeZero` — the old report's forty zero supplier lines are noise.
 */
export function balanceSheetRows(sheets: BalanceSheet[], options: { includeZero?: boolean } = {}): ReportRow[] {
  const rows: ReportRow[] = [];
  const blank = () => sheets.map(() => null);
  const show = (amounts: Pence[]) => options.includeZero || amounts.some((a) => a !== 0);
  const [first] = sheets;

  first.sections.forEach((section, s) => {
    rows.push({ kind: "section", label: section.title, code: null, amounts: blank() });
    section.groups.forEach((group, g) => {
      // Lines from every column, in the order they first appear.
      const keys = [...new Set(sheets.flatMap((sheet) => sheet.sections[s].groups[g].lines.map((l) => l.key)))];
      const lineRows: ReportRow[] = [];
      for (const key of keys) {
        const found = sheets.map((sheet) => sheet.sections[s].groups[g].lines.find((l) => l.key === key));
        const amounts = found.map((l) => l?.amount ?? 0);
        const any = found.find(Boolean)!;
        const detailKeys = [...new Set(found.flatMap((l) => l?.detail?.map((d) => d.key) ?? []))];
        const details = detailKeys
          .map((dk) => {
            const parts = found.map((l) => l?.detail?.find((d) => d.key === dk));
            return { label: parts.find(Boolean)!.label, amounts: parts.map((d) => d?.amount ?? 0) };
          })
          .filter((d) => show(d.amounts));
        if (!show(amounts) && details.length === 0) continue;
        lineRows.push({ kind: "line", label: any.label, code: any.code, amounts });
        for (const d of details) lineRows.push({ kind: "detail", label: d.label, code: null, amounts: d.amounts });
      }
      const totals = sheets.map((sheet) => sheet.sections[s].groups[g].total);
      if (lineRows.length === 0 && !show(totals)) return;
      rows.push({ kind: "group", label: group.title, code: null, amounts: blank() });
      rows.push(...lineRows);
      rows.push({ kind: "groupTotal", label: `Total ${group.title.toLowerCase()}`, code: null, amounts: totals });
    });
    rows.push({
      kind: "sectionTotal",
      label: `Total ${section.title.toLowerCase()}`,
      code: null,
      amounts: sheets.map((sheet) => sheet.sections[s].total),
    });
  });
  rows.push({
    kind: "grandTotal",
    label: "Total liabilities and equity",
    code: null,
    amounts: sheets.map((sheet) => sheet.totalLiabilitiesAndEquity),
  });
  return rows;
}
