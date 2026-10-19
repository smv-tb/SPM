import type { ReportRow } from "./balance-sheet";
import { AGE_BUCKETS, AGE_BUCKET_LABEL, type AgedDebtors } from "./aged-debtors";
import type { TrialBalance } from "./trial-balance";

/** Trial balance as printable rows: Debit and Credit columns, a line per account, totals last. */
export function trialBalanceRows(tb: TrialBalance): ReportRow[] {
  return [
    ...tb.rows.map<ReportRow>((r) => ({
      kind: "line",
      label: r.name,
      code: r.code,
      amounts: [r.debit || null, r.credit || null],
    })),
    { kind: "grandTotal", label: "Total", code: null, amounts: [tb.totalDebit, tb.totalCredit] },
  ];
}

export const TRIAL_BALANCE_COLUMNS = ["Debit", "Credit"];

/** Aged debtors as printable rows: a column per age bucket, unused credit and balance. */
export function agedDebtorsRows(report: AgedDebtors): ReportRow[] {
  return [
    ...report.rows.map<ReportRow>((r) => ({
      kind: "line",
      label: r.contactName,
      code: null,
      amounts: [...AGE_BUCKETS.map((b) => r[b]), -r.unusedCredit || 0, r.balance],
    })),
    {
      kind: "grandTotal",
      label: "Total",
      code: null,
      amounts: [...AGE_BUCKETS.map((b) => report.totals[b]), -report.totals.unusedCredit || 0, report.totals.balance],
    },
  ];
}

export const AGED_DEBTORS_COLUMNS = [...AGE_BUCKETS.map((b) => AGE_BUCKET_LABEL[b]), "Unused credit", "Balance"];
