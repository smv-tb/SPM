"use client";

import { Pencil, Trash2, CheckCircle2, Circle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SortableTh } from "@/components/ui/sortable-th";
import type { SortDirection } from "@/hooks/use-sortable-data";
import { formatCurrency } from "@/lib/utils";
import { typeLabel, typeVariant, formatFundingDate } from "./funding-helpers";

export type UtilizationMap = Record<string, { utilization: number | null; isOverBudget: boolean }>;

interface Props {
  title: string;
  records: any[];
  total: number;
  showUtilization?: boolean;
  utilizationMap: UtilizationMap;
  customFields: { columns: { id: string; name: string }[]; cell: (entityId: string, column: any) => string };
  sortKey: string | null;
  sortDir: SortDirection;
  onSort: (key: string) => void;
  onEdit: (record: any) => void;
  onDelete: (id: string, fundId: string) => void;
}

export function FundingSectionTable({
  title, records: recs, total, showUtilization = false, utilizationMap, customFields: cf,
  sortKey, sortDir, onSort: toggleSort, onEdit, onDelete,
}: Props) {
  if (recs.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <span className="text-base font-bold">{formatCurrency(total)}</span>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <SortableTh label="ID" sortKey="fundId" activeKey={sortKey} direction={sortDir} onSort={toggleSort} className="px-5" />
              <SortableTh label="Fund Name" sortKey="fundName" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              <SortableTh label="Type" sortKey="type" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              <SortableTh label="Source" sortKey="source" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              <SortableTh label="Date" sortKey="date" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="center" />
              <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Period</th>
              <SortableTh label="Amount" sortKey="amount" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
              <SortableTh label="Verified" sortKey="verified" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="center" />
              {showUtilization && <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-32">Utilization</th>}
              {cf.columns.map(c => <th key={c.id} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{c.name}</th>)}
              <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recs.map(r => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{r.fundId}</td>
                <td className="px-3 py-3 font-medium max-w-[200px] truncate">{r.fundName}</td>
                <td className="px-3 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeVariant[r.type] ?? "bg-muted text-foreground"}`}>
                    {typeLabel[r.type] ?? r.type}
                  </span>
                </td>
                <td className="px-3 py-3 text-muted-foreground">{r.source}</td>
                <td className="px-3 py-3 text-center text-xs text-muted-foreground whitespace-nowrap">{formatFundingDate(r.date)}</td>
                <td className="px-3 py-3 text-center text-xs text-muted-foreground whitespace-nowrap">
                  {r.periodStart || r.periodEnd
                    ? `${formatFundingDate(r.periodStart)} – ${formatFundingDate(r.periodEnd)}`
                    : "—"}
                </td>
                <td className="px-3 py-3 text-right font-semibold">{formatCurrency(r.amount)}</td>
                <td className="px-3 py-3 text-center">
                  {r.verified ? <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" /> : <Circle className="w-4 h-4 text-muted-foreground inline" />}
                </td>
                {showUtilization && (
                  <td className="px-3 py-3">
                    {utilizationMap[r.id]?.utilization != null ? (
                      <div className="flex items-center gap-2">
                        <Progress value={utilizationMap[r.id].utilization! * 100} className="flex-1" />
                        {utilizationMap[r.id].isOverBudget && (
                          <span className="text-xs font-bold text-red-600">Over</span>
                        )}
                      </div>
                    ) : (
                      // Spend can only be attributed to a record through its
                      // phase; without one there is nothing honest to show.
                      <span className="text-xs text-muted-foreground" title="No phase set — spend can't be attributed to this record">
                        —
                      </span>
                    )}
                    {r.trancheSummary && r.trancheSummary.totalCount > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Tranches settled {r.trancheSummary.receivedCount} of {r.trancheSummary.totalCount}
                      </p>
                    )}
                  </td>
                )}
                {cf.columns.map(c => <td key={c.id} className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{cf.cell(r.id, c)}</td>)}
                <td className="px-5 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => onEdit(r)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onDelete(r.id, r.fundId)} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
