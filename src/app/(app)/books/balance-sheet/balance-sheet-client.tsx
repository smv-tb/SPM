"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-label";
import { formatPence, fromPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { downloadCSV } from "@/lib/export-csv";
import type { ReportRow } from "@/lib/accounting/balance-sheet";
import { Download, FileText } from "lucide-react";

interface SheetSummary {
  asAt: string;
  yearStart: string;
  balanced: boolean;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
}

interface Props {
  sheets: SheetSummary[];
  rows: ReportRow[];
  includeZero: boolean;
}

const ROW_CLASS: Record<ReportRow["kind"], string> = {
  section: "font-semibold text-base pt-5",
  group: "font-semibold pl-4 pt-3",
  line: "pl-8",
  detail: "pl-12 text-muted-foreground text-xs",
  groupTotal: "pl-4 font-semibold border-t border-border",
  sectionTotal: "font-semibold border-t-2 border-border",
  grandTotal: "font-bold text-base border-t-2 border-double border-foreground",
};

export function BalanceSheetClient({ sheets, rows, includeZero }: Props) {
  const router = useRouter();
  const [main, comparative] = sheets;
  const [asAt, setAsAt] = useState(main.asAt);
  const [compare, setCompare] = useState(comparative?.asAt ?? "");
  const [zero, setZero] = useState(includeZero);

  const query = () => {
    const params = new URLSearchParams({ asAt });
    if (compare) params.set("compare", compare);
    if (zero) params.set("zero", "1");
    return params;
  };
  const pdfQuery = () => {
    const params = new URLSearchParams({ asAt: main.asAt });
    if (comparative) params.set("compare", comparative.asAt);
    if (includeZero) params.set("includeZero", "true");
    return params;
  };

  function exportCsv() {
    // Exact decimal amounts, one column per date, like the trial balance export.
    downloadCSV(
      rows.map((r) => ({
        Kind: r.kind,
        Code: r.code ?? "",
        Item: r.label,
        ...Object.fromEntries(sheets.map((s, i) => [s.asAt, r.amounts[i] === null ? "" : fromPence(r.amounts[i]!)])),
      })),
      `balance-sheet-${main.asAt}${comparative ? `-vs-${comparative.asAt}` : ""}.csv`
    );
  }

  return (
    <>
      <Topbar
        title="Balance sheet"
        subtitle={`As at ${formatDate(main.asAt)}`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Balance sheet", href: "/books/balance-sheet" },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/books/reports/balance-sheet/pdf?${pdfQuery()}`} target="_blank" rel="noreferrer">
                <FileText className="w-3.5 h-3.5" /> PDF
              </a>
            </Button>
          </div>
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5 max-w-4xl">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/books/balance-sheet?${query()}`);
          }}
        >
          <div>
            <FormLabel htmlFor="bs-as-at">As at</FormLabel>
            <Input id="bs-as-at" type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} />
          </div>
          <div>
            <FormLabel htmlFor="bs-compare">Compare with (optional)</FormLabel>
            <Input id="bs-compare" type="date" value={compare} onChange={(e) => setCompare(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
            Show zero lines
          </label>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>

        <Card>
          <CardContent className="p-5">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 text-left font-semibold" />
                  {sheets.map((s) => (
                    <th key={s.asAt} className="py-2 pl-4 text-right font-semibold whitespace-nowrap">
                      {formatDate(s.asAt)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={ROW_CLASS[r.kind]}>
                    <td className="py-1.5">
                      {r.code && <span className="text-muted-foreground mr-2 tabular-nums">{r.code}</span>}
                      {r.label}
                    </td>
                    {r.amounts.map((a, j) => (
                      <td key={j} className="py-1.5 pl-4 text-right tabular-nums whitespace-nowrap">
                        {a === null ? "" : formatPence(a)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {sheets.every((s) => s.balanced) ? (
          <p className="text-sm text-muted-foreground">
            Assets equal liabilities plus equity. The profit for the year runs from {formatDate(main.yearStart)}; earlier
            years&apos; profit shows as brought forward until year-end close moves it into retained earnings.
          </p>
        ) : (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Out of balance by {formatPence(main.totalAssets - main.totalLiabilitiesAndEquity)}. Posted journals always
            balance, so this needs investigating before the report is relied on.
          </div>
        )}
      </main>
    </>
  );
}
