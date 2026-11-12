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

/** The words and links that differ between the two sides of the ledger. */
const SIDES = {
  debtors: {
    title: "Aged debtors",
    path: "aged-debtors",
    subtitle: "What customers owed on",
    party: "Customer",
    document: "/books/invoices",
    emptyTitle: "Nobody owes anything",
    emptyText: "No unpaid invoices and no unused credit on this date.",
    unused: "Unused credit",
    account: "trade debtors",
    code: "1100",
  },
  creditors: {
    title: "Aged creditors",
    path: "aged-creditors",
    subtitle: "What we owed suppliers on",
    party: "Supplier",
    document: "/books/bills",
    emptyTitle: "Nothing is owed to suppliers",
    emptyText: "No unpaid bills and no money paid on account on this date.",
    unused: "Paid on account",
    account: "trade creditors",
    code: "2100",
  },
} as const;

interface Props {
  side: keyof typeof SIDES;
  report: AgedDebtors & { ledgerBalance: number; difference: number };
}

const money = (pence: number) => (pence === 0 ? "—" : formatPence(pence));

export function AgedReport({ side, report }: Props) {
  const text = SIDES[side];
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
    // Exact decimal amounts, one row per contact and a total, like the TB export.
    const rows = [
      ...report.rows.map((r) => ({ name: r.contactName, ...r })),
      { name: "Total", ...report.totals },
    ].map((r) => ({
      [text.party]: r.name,
      ...Object.fromEntries(AGE_BUCKETS.map((b) => [AGE_BUCKET_LABEL[b], fromPence(r[b])])),
      [text.unused]: fromPence(-r.unusedCredit),
      Balance: fromPence(r.balance),
    }));
    downloadCSV(rows, `${text.path}-${report.asAt}.csv`);
  }

  return (
    <>
      <Topbar
        title={text.title}
        subtitle={`${text.subtitle} ${formatDate(report.asAt)}, by how late it is`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: text.title, href: `/books/${text.path}` },
        ]}
        actions={
          report.rows.length > 0 ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/books/reports/${text.path}/pdf?asAt=${report.asAt}`} target="_blank" rel="noreferrer">
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
            router.push(`/books/${text.path}?asAt=${asAt}`);
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
              <EmptyState icon={Hourglass} title={text.emptyTitle} description={text.emptyText} />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left font-semibold min-w-48">{text.party}</th>
                    {AGE_BUCKETS.map((b) => (
                      <th key={b} className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                        {AGE_BUCKET_LABEL[b]}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">{text.unused}</th>
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
                              <Link href={`${text.document}/${invoice.id}`} className="text-primary hover:underline">
                                {invoice.number ?? "Bill"}
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
            Agrees with the {text.account} account ({text.code}): {formatPence(report.ledgerBalance)}.
          </p>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            {text.account[0].toUpperCase() + text.account.slice(1)} ({text.code}) stands at{" "}
            {formatPence(report.ledgerBalance)} on this date, {formatPence(Math.abs(report.difference))}{" "}
            {report.difference > 0 ? "more" : "less"} than this report. A manual journal to {text.code} would
            explain the gap.
          </div>
        )}
      </main>
    </>
  );
}
