/**
 * The profit and loss account as a pure calculation over posted movements in
 * a period. Like the balance sheet it ends as a flat `ReportRow[]` with one
 * amount per column, so the screen, the CSV and the PDF print the same thing
 * and a comparative period is just a second column.
 *
 * Layout: income, cost of sales, gross profit, expenses (operating, then
 * finance costs), net profit. Groups follow the chart's code ranges.
 */

import { sumPence, type Pence } from "@/lib/money";
import type { AccountType } from "./chart";
import type { ReportRow } from "./balance-sheet";
import type { AccountMovement, ReportAccount } from "./trial-balance";

export interface ProfitAndLossLine {
  key: string;
  code: string;
  label: string;
  amount: Pence;
}

export interface ProfitAndLossGroup {
  key: GroupKey;
  title: string;
  lines: ProfitAndLossLine[];
  total: Pence;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  groups: ProfitAndLossGroup[];
  income: Pence;
  costOfSales: Pence;
  grossProfit: Pence;
  expenses: Pence;
  netProfit: Pence;
}

type GroupKey = "income" | "costOfSales" | "operating" | "finance";

const GROUPS: { key: GroupKey; title: string }[] = [
  { key: "income", title: "Income" },
  { key: "costOfSales", title: "Cost of sales" },
  { key: "operating", title: "Operating expenses" },
  { key: "finance", title: "Finance costs" },
];

/** Which group an income or expense account prints in; other types are not on the P&L. */
export function pnlGroupFor(type: AccountType, code: string): GroupKey | null {
  const n = Number(code);
  if (type === "INCOME") return "income";
  if (type !== "EXPENSE") return null;
  if (n < 6000) return "costOfSales";
  if (n >= 8000) return "finance";
  return "operating";
}

export function buildProfitAndLoss(input: {
  from: string;
  to: string;
  accounts: ReportAccount[];
  /** Posted movements dated within the period (and any dimension filter). */
  movements: AccountMovement[];
}): ProfitAndLoss {
  const byId = new Map(input.movements.map((m) => [m.accountId, m]));
  const lines = new Map<GroupKey, ProfitAndLossLine[]>();

  for (const account of [...input.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const group = pnlGroupFor(account.type, account.code);
    if (!group) continue;
    const m = byId.get(account.id);
    // Income on its credit side, expenses on their debit side.
    const amount = !m ? 0 : account.type === "INCOME" ? m.credit - m.debit : m.debit - m.credit;
    lines.set(group, [...(lines.get(group) ?? []), { key: account.id, code: account.code, label: account.name, amount }]);
  }

  const groups = GROUPS.map(({ key, title }) => {
    const l = lines.get(key) ?? [];
    return { key, title, lines: l, total: sumPence(l.map((x) => x.amount)) };
  });
  const total = (key: GroupKey) => groups.find((g) => g.key === key)!.total;
  const income = total("income");
  const costOfSales = total("costOfSales");
  const expenses = total("operating") + total("finance");
  return {
    from: input.from,
    to: input.to,
    groups,
    income,
    costOfSales,
    grossProfit: income - costOfSales,
    expenses,
    netProfit: income - costOfSales - expenses,
  };
}

/**
 * One or more periods as rows aligned by account. A line that is zero in every
 * column is left out unless `includeZero`; so is a group with nothing to show.
 */
export function profitAndLossRows(reports: ProfitAndLoss[], options: { includeZero?: boolean } = {}): ReportRow[] {
  const rows: ReportRow[] = [];
  const blank = () => reports.map(() => null);
  const show = (amounts: Pence[]) => options.includeZero || amounts.some((a) => a !== 0);
  const totals = (pick: (r: ProfitAndLoss) => Pence) => reports.map(pick);
  const groupOf = (r: ProfitAndLoss, key: GroupKey) => r.groups.find((g) => g.key === key)!;

  const section = (title: string, keys: GroupKey[], totalLabel: string, pick: (r: ProfitAndLoss) => Pence, alwaysShow: boolean) => {
    const perGroup = keys.map((key) => {
      const accountKeys = [...new Set(reports.flatMap((r) => groupOf(r, key).lines.map((l) => l.key)))];
      const lineRows: ReportRow[] = [];
      for (const k of accountKeys) {
        const found = reports.map((r) => groupOf(r, key).lines.find((l) => l.key === k));
        const amounts = found.map((l) => l?.amount ?? 0);
        if (!show(amounts)) continue;
        const any = found.find(Boolean)!;
        lineRows.push({ kind: "line", label: any.label, code: any.code, amounts });
      }
      return { key, lineRows };
    }).filter((g) => g.lineRows.length > 0);

    // Sub-headings only earn their place when the section has more than one group showing.
    const body: ReportRow[] = [];
    for (const { key, lineRows } of perGroup) {
      if (perGroup.length > 1) body.push({ kind: "group", label: groupOf(reports[0], key).title, code: null, amounts: blank() });
      body.push(...lineRows);
      if (perGroup.length > 1) {
        body.push({
          kind: "groupTotal",
          label: `Total ${groupOf(reports[0], key).title.toLowerCase()}`,
          code: null,
          amounts: totals((r) => groupOf(r, key).total),
        });
      }
    }
    if (body.length === 0 && !alwaysShow && !show(totals(pick))) return;
    rows.push({ kind: "section", label: title, code: null, amounts: blank() });
    rows.push(...body);
    rows.push({ kind: "sectionTotal", label: totalLabel, code: null, amounts: totals(pick) });
  };

  section("Income", ["income"], "Total income", (r) => r.income, true);
  section("Cost of sales", ["costOfSales"], "Total cost of sales", (r) => r.costOfSales, false);
  rows.push({ kind: "sectionTotal", label: "Gross profit", code: null, amounts: totals((r) => r.grossProfit) });
  section("Expenses", ["operating", "finance"], "Total expenses", (r) => r.expenses, false);
  rows.push({ kind: "grandTotal", label: "Net profit or loss", code: null, amounts: totals((r) => r.netProfit) });
  return rows;
}
