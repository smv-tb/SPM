"use client";

import { Pencil, Trash2 } from "lucide-react";
import { SortableTh } from "@/components/ui/sortable-th";
import { formatCurrencyAccounting as formatMoney, formatDate, daysUntil, percentDoneForStatus } from "@/lib/utils";
import type { SortDirection } from "@/hooks/use-sortable-data";
import { ALL_PRIORITIES, ALL_STATUSES, ownerOf, taskBudgetTotals, type TaskGroup } from "./tasks-helpers";

interface Props {
  group: TaskGroup;
  customFields: { columns: { id: string; name: string }[]; cell: (entityId: string, column: any) => string };
  sortKey: string | null;
  sortDir: SortDirection;
  onSort: (key: string) => void;
  updatingId: string | null;
  onInlineUpdate: (taskId: string, fields: Record<string, any>) => void;
  onEdit: (task: any) => void;
  onDelete: (taskId: string, code: string) => void;
}

export function TaskGroupTable({ group, customFields: cf, sortKey, sortDir, onSort, updatingId, onInlineUpdate, onEdit, onDelete }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse min-w-full">
        <thead>
          <tr className="border-b-2 border-input">
            <SortableTh label="Code" sortKey="code" activeKey={sortKey} direction={sortDir} onSort={onSort} className="px-4" />
            <SortableTh label="Task" sortKey="title" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortableTh label="Owner" sortKey="owner" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortableTh label="Priority" sortKey="priority" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortableTh label="% Done" sortKey="percentDone" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortableTh label="Est. Budget" sortKey="estBudget" activeKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
            <SortableTh label="Spent" sortKey="actualSpend" activeKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
            <SortableTh label="Remaining" sortKey="remaining" activeKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
            <SortableTh label="Due" sortKey="dueDate" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <th scope="col" className="text-right px-2 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">Time left</th>
            {cf.columns.map(c => <th key={c.id} scope="col" className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{c.name}</th>)}
            <th scope="col" className="px-2 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {/* Budget summary row for this milestone group */}
          {(() => {
            const { est: gEst, spent: gSpend, remaining: gRem } = taskBudgetTotals(group.tasks);
      if (gEst === 0 && gSpend === 0) return null;
            return (
              <tr className="bg-surface-container-low text-sm">
                <td colSpan={6} className="px-4 py-2 text-muted-foreground font-medium">Budget Summary</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(gEst)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(gSpend)}</td>
                <td className={`px-3 py-2 text-right font-bold tabular-nums ${gRem < 0 ? "text-destructive" : ""}`}>{gRem < 0 && <span aria-hidden>▲ </span>}{formatMoney(gRem)}</td>
                <td colSpan={3 + cf.columns.length} />
              </tr>
            );
          })()}
          {group.tasks.map((task) => {
            const isDone = task.status === "DONE";
            const days = isDone ? null : daysUntil(new Date(task.dueDate));
            const owner = ownerOf(task);
            const isUpdating = updatingId === task.id;

            return (
              <tr key={task.id} className={`hover:bg-accent/60 transition-colors ${isUpdating ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-sm text-muted-foreground tabular-nums">{task.code}</span>
                </td>
                <td className="px-3 py-3 max-w-[300px]">
                  <p className="font-medium truncate">{task.title}</p>
                  {task.taskTags?.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {task.taskTags.map(({ tag }: any) => (
                        <span key={tag.id} className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground ring-1 ring-inset ring-input">
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-sm text-muted-foreground whitespace-nowrap">{owner}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <select
                    value={task.status}
                    onChange={e => {
                      const status = e.target.value;
                      onInlineUpdate(task.id, { status, percentDone: percentDoneForStatus(status, task.percentDone) });
                    }}
                    aria-label={`Status of ${task.code}`}
                    className="text-sm h-8 px-2 rounded-lg border border-input bg-card cursor-pointer"
                  >
                    {ALL_STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <select
                    value={task.priority}
                    onChange={e => onInlineUpdate(task.id, { priority: e.target.value })}
                    aria-label={`Priority of ${task.code}`}
                    className="text-sm h-8 px-2 rounded-lg border border-input bg-card cursor-pointer"
                  >
                    {ALL_PRIORITIES.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="w-16 inline-block text-sm px-2 py-1 text-center text-muted-foreground tabular-nums" data-testid="percent-done-display">
                    {task.percentDone}%
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-sm tabular-nums whitespace-nowrap">
                  {formatMoney(task.estBudget ?? 0)}
                </td>
                <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatMoney(task.actualSpend ?? 0)}
                </td>
                <td className="px-3 py-3 text-right text-sm tabular-nums whitespace-nowrap">
                  {(() => {
                    const rem = (task.estBudget ?? 0) - (task.actualSpend ?? 0);
                    if ((task.estBudget ?? 0) === 0 && (task.actualSpend ?? 0) === 0) return <span className="text-muted-foreground">—</span>;
                    return <span className={rem < 0 ? "text-destructive font-semibold" : ""}>{rem < 0 && <span aria-hidden>▲ </span>}{formatMoney(rem)}</span>;
                  })()}
                </td>
                <td className="px-3 py-3 text-muted-foreground text-sm tabular-nums whitespace-nowrap">
                  {formatDate(new Date(task.dueDate))}
                </td>
                <td className={`px-2 py-3 text-right text-sm font-semibold whitespace-nowrap tabular-nums ${
                  isDone ? "text-primary" :
                  days != null && days < 0 ? "text-destructive" :
                  days != null && days < 14 ? "text-warning" :
                  "text-muted-foreground"
                }`}>
                  {isDone ? "✓ Done" : days != null ? (days < 0 ? `▲ ${Math.abs(days)}d overdue` : days < 14 ? `● ${days}d` : `${days}d`) : "—"}
                </td>
                {cf.columns.map(c => <td key={c.id} className="px-3 py-3 text-sm text-muted-foreground whitespace-nowrap">{cf.cell(task.id, c)}</td>)}
                <td className="px-2 py-3 whitespace-nowrap">
                  <div className="flex gap-1">
                    <button
                      onClick={() => onEdit(task)}
                      className="grid place-items-center h-8 w-8 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      title="Edit task"
                      aria-label={`Edit task ${task.code}`}
                    >
                      <Pencil className="w-4 h-4" aria-hidden />
                    </button>
                    <button
                      onClick={() => onDelete(task.id, task.code)}
                      className="grid place-items-center h-8 w-8 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
                      title="Delete task"
                      aria-label={`Delete task ${task.code}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
