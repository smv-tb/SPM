"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-label";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPence, fromPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { downloadCSV } from "@/lib/export-csv";
import { AGE_BUCKETS, AGE_BUCKET_LABEL, type AgedDebtors } from "@/lib/accounting/aged-debtors";
import { ChevronDown, ChevronRight, Download, Hourglass, FileText } from "lucide-react";

interface Props {
  report: AgedDebtors & { ledgerBalance: number; difference: number };
}

const money = (pence: number) => (pence === 0 ? "—" : formatPence(pence));

export function AgedDebtorsClient({ report }: Props) {
  const router = useRouter();
  const [asAt, setAsAt] = useState(report.asAt);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function exportCsv() {
    // Exact decimal amounts, one row per customer and a total, like the TB export.
    const rows = [
      ...report.rows.map((r) => ({ customer: r.contactName, ...r })),
      { customer: "Total", ...report.totals },
    ].map((r) => ({
      Customer: r.customer,
      ...Object.fromEntries(AGE_BUCKETS.map((b) => [AGE_BUCKET_LABEL[b], fromPence(r[b])])),
      "Unused credit": fromPence(-r.unusedCredit),
      Balance: fromPence(r.balance),
    }));
    downloadCSV(rows, `aged-debtors-${report.asAt}.csv`);
  }

  return (
    <>
      <Topbar
        title="Aged debtors"
        subtitle={`What customers owed on ${formatDate(report.asAt)}, by how late it is`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Aged debtors", href: "/books/aged-debtors" },
        ]}
        actions={
          report.rows.length > 0 ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/books/reports/aged-debtors/pdf?asAt=${report.asAt}`} target="_blank" rel="noreferrer">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </a>
              </Button>
            </div>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/books/aged-debtors?asAt=${asAt}`);
          }}
        >
          <div>
            <FormLabel htmlFor="aged-as-at">As at</FormLabel>
            <Input id="aged-as-at" type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} />
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>

        <Card>
          <CardContent className="px-0 py-0 overflow-x-auto">
            {report.rows.length === 0 ? (
              <EmptyState icon={Hourglass} title="Nobody owes anything" description="No unpaid invoices and no unused credit on this date." />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left font-semibold min-w-48">Customer</th>
                    {AGE_BUCKETS.map((b) => (
                      <th key={b} className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                        {AGE_BUCKET_LABEL[b]}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Unused credit</th>
                    <th className="px-5 py-3 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.rows.map((row) => (
                    <Fragment key={row.contactId}>
                      <tr className="hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <button
                            type="button"
                            className="flex items-center gap-1 text-left font-medium hover:text-primary"
                            aria-expanded={open.has(row.contactId)}
                            onClick={() => toggle(row.contactId)}
                            disabled={row.invoices.length === 0}
                          >
                            {row.invoices.length > 0 &&
                              (open.has(row.contactId) ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              ))}
                            {row.contactName}
                          </button>
                        </td>
                        {AGE_BUCKETS.map((b) => (
                          <td
                            key={b}
                            className={`px-3 py-3 text-right tabular-nums ${b !== "current" && row[b] > 0 ? "text-red-600" : ""}`}
                          >
                            {money(row[b])}
                          </td>
                        ))}
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {row.unusedCredit > 0 ? `-${formatPence(row.unusedCredit)}` : "—"}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums font-medium">{formatPence(row.balance)}</td>
                      </tr>
                      {open.has(row.contactId) &&
                        row.invoices.map((invoice) => (
                          <tr key={invoice.id} className="bg-muted/10 text-muted-foreground">
                            <td className="pl-10 pr-5 py-2">
                              <Link href={`/books/invoices/${invoice.id}`} className="text-primary hover:underline">
                                {invoice.number}
                              </Link>{" "}
                              due {formatDate(invoice.dueDate)}
                            </td>
                            {AGE_BUCKETS.map((b) => (
                              <td key={b} className="px-3 py-2 text-right tabular-nums">
                                {invoice.bucket === b ? formatPence(invoice.outstanding) : ""}
                              </td>
                            ))}
                            <td colSpan={2} />
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-semibold">
                  <tr>
                    <td className="px-5 py-3">Total</td>
                    {AGE_BUCKETS.map((b) => (
                      <td key={b} className="px-3 py-3 text-right tabular-nums">
                        {money(report.totals[b])}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right tabular-nums">
                      {report.totals.unusedCredit > 0 ? `-${formatPence(report.totals.unusedCredit)}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPence(report.totals.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>

        {/* The report is built from documents; the ledger is the books. They should agree. */}
        {report.difference === 0 ? (
          <p className="text-sm text-muted-foreground">
            Agrees with the trade debtors account (1100): {formatPence(report.ledgerBalance)}.
          </p>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            Trade debtors (1100) stands at {formatPence(report.ledgerBalance)} on this date,{" "}
            {formatPence(Math.abs(report.difference))} {report.difference > 0 ? "more" : "less"} than this
            report. A manual journal to 1100, or a document dated before this day that was voided after it,
            would explain the gap.
          </div>
        )}
      </main>
    </>
  );
}
