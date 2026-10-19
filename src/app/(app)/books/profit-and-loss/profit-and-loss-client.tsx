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
import type { ProfitAndLoss } from "@/lib/accounting/profit-and-loss";
import { Download, FileText } from "lucide-react";

interface Props {
  projects: { id: string; name: string; phases: { id: string; name: string }[] }[];
  /** The query as parsed on the server, so the form starts where the report is. */
  query: Record<string, string>;
  result: { error: string } | { reports: ProfitAndLoss[]; rows: ReportRow[] };
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

const period = (r: { from: string; to: string }) => `${formatDate(r.from)} – ${formatDate(r.to)}`;

export function ProfitAndLossClient({ projects, query, result }: Props) {
  const router = useRouter();
  const [from, setFrom] = useState(query.from ?? "");
  const [to, setTo] = useState(query.to ?? "");
  const [compareFrom, setCompareFrom] = useState(query.compareFrom ?? "");
  const [compareTo, setCompareTo] = useState(query.compareTo ?? "");
  const [projectId, setProjectId] = useState(query.projectId ?? "");
  const [phaseId, setPhaseId] = useState(query.phaseId ?? "");
  const [zero, setZero] = useState(query.includeZero === "true");
  const phases = projects.find((p) => p.id === projectId)?.phases ?? [];

  const params = (values: Record<string, string | boolean>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) if (v) p.set(k, String(v));
    return p;
  };
  const formValues = { from, to, compareFrom, compareTo, projectId, phaseId, includeZero: zero };

  const header = (
    <Topbar
      title="Profit and loss"
      subtitle={"reports" in result ? period(result.reports[0]) : undefined}
      breadcrumbs={[
        { label: "Books", href: "/books" },
        { label: "Profit and loss", href: "/books/profit-and-loss" },
      ]}
      actions={
        "reports" in result ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCSV(
                  result.rows.map((r) => ({
                    Kind: r.kind,
                    Code: r.code ?? "",
                    Item: r.label,
                    ...Object.fromEntries(
                      result.reports.map((s, i) => [`${s.from} to ${s.to}`, r.amounts[i] === null ? "" : fromPence(r.amounts[i]!)])
                    ),
                  })),
                  `profit-and-loss-${result.reports[0].from}-to-${result.reports[0].to}.csv`
                )
              }
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/books/reports/profit-and-loss/pdf?${params(query)}`} target="_blank" rel="noreferrer">
                <FileText className="w-3.5 h-3.5" /> PDF
              </a>
            </Button>
          </div>
        ) : null
      }
    />
  );

  return (
    <>
      {header}
      <main className="flex-1 overflow-auto p-6 space-y-5 max-w-4xl">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/books/profit-and-loss?${params(formValues)}`);
          }}
        >
          <div>
            <FormLabel htmlFor="pl-from">From</FormLabel>
            <Input id="pl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <FormLabel htmlFor="pl-to">To</FormLabel>
            <Input id="pl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <FormLabel htmlFor="pl-cfrom">Compare from</FormLabel>
            <Input id="pl-cfrom" type="date" value={compareFrom} onChange={(e) => setCompareFrom(e.target.value)} />
          </div>
          <div>
            <FormLabel htmlFor="pl-cto">Compare to</FormLabel>
            <Input id="pl-cto" type="date" value={compareTo} onChange={(e) => setCompareTo(e.target.value)} />
          </div>
          <div>
            <FormLabel htmlFor="pl-project">Project</FormLabel>
            <select
              id="pl-project"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setPhaseId("");
              }}
            >
              <option value="">All (whole company)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {phases.length > 0 && (
            <div>
              <FormLabel htmlFor="pl-phase">Phase</FormLabel>
              <select
                id="pl-phase"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={phaseId}
                onChange={(e) => setPhaseId(e.target.value)}
              >
                <option value="">All phases</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
            Show zero lines
          </label>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
        <p className="text-xs text-muted-foreground -mt-2">
          Leave the dates empty for the current financial year to date. Comparative dates need both a start and an end.
        </p>

        {"error" in result ? (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{result.error}</div>
        ) : (
          <>
            <Card>
              <CardContent className="p-5">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 text-left font-semibold" />
                      {result.reports.map((s) => (
                        <th key={s.from + s.to} className="py-2 pl-4 text-right font-semibold whitespace-nowrap">
                          {period(s)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r, i) => (
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
            {(query.projectId || query.phaseId) && (
              <p className="text-sm text-muted-foreground">
                Filtered to journal lines tagged with the selected project or phase. Lines posted without a tag are not
                included, so the figures will not add up to the whole company&apos;s.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
