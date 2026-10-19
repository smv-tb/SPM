import type { Accessor } from "@/hooks/use-sortable-data";

export const ALL_STATUSES = ["", "BACKLOG", "IN_PROGRESS", "DONE", "BLOCKED", "ON_HOLD", "OVERDUE"];
export const ALL_PRIORITIES = ["", "HIGH", "MED", "LOW"];
export const PRIORITY_WEIGHT: Record<string, number> = { HIGH: 3, MED: 2, LOW: 1 };

export function ownerOf(task: any): string {
  return task.resource?.name
    ?? task.taskAssignments?.find((a: any) => a.role === "OWNER")?.user?.name
    ?? task.taskAssignments?.[0]?.user?.name
    ?? "—";
}

export const taskAccessors: Record<string, Accessor<any>> = {
  code: t => t.code,
  title: t => t.title,
  owner: t => { const o = ownerOf(t); return o === "—" ? null : o; },
  status: t => t.status,
  priority: t => PRIORITY_WEIGHT[t.priority] ?? 0,
  percentDone: t => t.percentDone,
  estBudget: t => t.estBudget ?? 0,
  actualSpend: t => t.actualSpend ?? 0,
  remaining: t => (t.estBudget ?? 0) - (t.actualSpend ?? 0),
  dueDate: t => t.dueDate ? new Date(t.dueDate) : null,
};

export interface TaskFilters {
  search: string;
  status: string;
  milestone: string;
  priority: string;
  tag: string;
}

export function filterTasks(tasks: any[], f: TaskFilters): any[] {
  return tasks.filter(t => {
    if (f.search && !t.title.toLowerCase().includes(f.search.toLowerCase()) && !t.code.toLowerCase().includes(f.search.toLowerCase())) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.milestone && t.milestone?.id !== f.milestone) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.tag && !t.taskTags?.some((tt: any) => tt.tag.name === f.tag)) return false;
    return true;
  });
}

export interface TaskGroup {
  id: string;
  code: string;
  title: string;
  tasks: any[];
}

/** Groups already-sorted tasks by milestone, in first-seen order. */
export function groupTasksByMilestone(tasks: any[]): TaskGroup[] {
  const map = new Map<string, TaskGroup>();
  for (const t of tasks) {
    const key = t.milestone?.id || "unknown";
    if (!map.has(key))
      map.set(key, { id: key, code: t.milestone?.code || "?", title: t.milestone?.title || "Unknown", tasks: [] });
    map.get(key)!.tasks.push(t);
  }
  return Array.from(map.values());
}

export function taskBudgetTotals(tasks: any[]) {
  const est = tasks.reduce((s, t) => s + (t.estBudget ?? 0), 0);
  const spent = tasks.reduce((s, t) => s + (t.actualSpend ?? 0), 0);
  return { est, spent, remaining: est - spent };
}

/** The API returns money as Decimal strings; the screen works in numbers. */
export function normaliseTaskMoney(t: any) {
  return {
    ...t,
    estBudget: t.estBudget ? Number(t.estBudget) : null,
    actualSpend: t.actualSpend ? Number(t.actualSpend) : null,
    extCosts: t.extCosts ? Number(t.extCosts) : null,
  };
}

export const TASK_CSV_COLUMNS = [
  { key: "code", label: "Code" },
  { key: "title", label: "Title" },
  { key: "milestone", label: "Milestone" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "percent_done", label: "% Done" },
  { key: "est_budget", label: "Est Budget" },
  { key: "actual_spend", label: "Actual Spend" },
  { key: "remaining", label: "Remaining" },
  { key: "ext_costs", label: "Ext Costs" },
  { key: "due_date", label: "Due Date" },
  { key: "owner", label: "Owner" },
];

export function toTaskCsvRows(tasks: any[]) {
  return tasks.map(t => ({
    code: t.code,
    title: t.title,
    milestone: t.milestone?.code ?? "",
    status: t.status,
    priority: t.priority,
    percent_done: t.percentDone,
    est_budget: t.estBudget ?? 0,
    actual_spend: t.actualSpend ?? 0,
    remaining: (t.estBudget ?? 0) - (t.actualSpend ?? 0),
    ext_costs: t.extCosts ?? 0,
    due_date: t.dueDate ? t.dueDate.split("T")[0] : "",
    owner: t.taskAssignments?.find((a: any) => a.role === "OWNER")?.user?.name ?? "",
  }));
}
