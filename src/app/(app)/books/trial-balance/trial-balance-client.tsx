"use client";

import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { downloadCSV } from "@/lib/export-csv";
import { fromPence, formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { ACCOUNT_TYPE_LABEL } from "@/lib/accounting/chart";
import type { TrialBalance } from "@/lib/accounting/trial-balance";
import { Download, Scale, FileText } from "lucide-react";

interface Props {
  asAt: string;
  trialBalance: TrialBalance;
}

export function TrialBalanceClient({ asAt, trialBalance }: Props) {
  const { rows, totalDebit, totalCredit, balanced } = trialBalance;

  function exportCsv() {
    // Amounts go out as exact decimal strings, not floats, so the accountant's
    // spreadsheet totals to the penny.
    downloadCSV(
      [
        ...rows.map((r) => ({
          code: r.code,
          name: r.name,
          type: ACCOUNT_TYPE_LABEL[r.type],
          debit: r.debit ? fromPence(r.debit) : "",
          credit: r.credit ? fromPence(r.credit) : "",
        })),
        { code: "", name: "Total", type: "", debit: fromPence(totalDebit), credit: fromPence(totalCredit) },
      ],
      `trial-balance-${asAt}.csv`,
      [
        { key: "code", label: "Code" },
        { key: "name", label: "Account" },
        { key: "type", label: "Type" },
        { key: "debit", label: "Debit" },
        { key: "credit", label: "Credit" },
      ]
    );
  }

  return (
    <>
      <Topbar
        title="Trial balance"
        subtitle={`As at ${formatDate(asAt)}`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Trial balance", href: "/books/trial-balance" },
        ]}
        actions={
          rows.length > 0 ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/books/reports/trial-balance/pdf?asAt=${asAt}`} target="_blank" rel="noreferrer">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </a>
              </Button>
            </div>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <Card>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="asAt">
                  As at
                </label>
                <Input id="asAt" name="asAt" type="date" className="w-44" defaultValue={asAt} />
              </div>
              <Button type="submit" variant="outline" size="sm">
                Show
              </Button>
              <div className="ml-auto">
                <Badge variant={balanced ? "success" : "danger"}>
                  {balanced ? "Balanced" : "Out of balance"}
                </Badge>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-0 pb-0">
            {rows.length === 0 ? (
              <EmptyState
                icon={Scale}
                title="Nothing posted by this date"
                description="Every account is at zero. Post a journal, or pick a later date."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground w-20">Code</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Account</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-28">Type</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-36">Debit</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground w-36">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 tabular-nums text-muted-foreground">{row.code}</td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/books/accounts/${row.id}?to=${asAt}`}
                          className="font-medium hover:text-primary"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{ACCOUNT_TYPE_LABEL[row.type]}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.debit ? formatPence(row.debit) : ""}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{row.credit ? formatPence(row.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/30">
                  <tr className="font-semibold">
                    <td className="px-5 py-3" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPence(totalDebit)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPence(totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
