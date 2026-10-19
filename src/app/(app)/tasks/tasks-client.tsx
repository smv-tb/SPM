"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { TaskModal } from "@/components/modals/TaskModal";
import { downloadCSV } from "@/lib/export-csv";
import { EmptyState } from "@/components/ui/empty-state";
import { clientFetch } from "@/lib/client-fetch";
import { useCustomFieldColumns } from "@/components/ui/custom-field-columns";
import { BudgetSummary } from "./BudgetSummary";
import { TaskGroupTable } from "./TaskGroupTable";
import {
  ALL_PRIORITIES, ALL_STATUSES, TASK_CSV_COLUMNS, filterTasks, groupTasksByMilestone,
  normaliseTaskMoney, taskAccessors, taskBudgetTotals, toTaskCsvRows,
} from "./tasks-helpers";
import { useSort, sortItems } from "@/hooks/use-sortable-data";
import { Plus, Search, Download, ListChecks, ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  initialTasks: any[];
  milestones: { id: string; code: string; title: string }[];
  tags: { id: string; name: string; color: string }[];
  resources: { id: string; name: string }[];
  costCategories: { id: string; name: string }[];
  projectId: string;
  projectName: string;
}

export function TasksClient({ initialTasks, milestones, tags, resources, costCategories, projectId, projectName }: Props) {
  const cf = useCustomFieldColumns(projectId, "TASK");
  const [tasks, setTasks] = useState(initialTasks);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterMilestone, setFilterMilestone] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterTag, setFilterTag] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);

  // Inline editing
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string>("");
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  // Collapsed milestones (keyed by milestone id for React 19 compatibility)
  const [collapsedMilestones, setCollapsedMilestones] = useState<Record<string, boolean>>({});

  const { sortKey, sortDir, toggleSort } = useSort("smartvie:sort:tasks");

  const toggleMilestone = (id: string) => {
    setCollapsedMilestones(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Filter tasks
  const filtered = useMemo(
    () => filterTasks(tasks, { search, status: filterStatus, milestone: filterMilestone, priority: filterPriority, tag: filterTag }),
    [tasks, search, filterStatus, filterMilestone, filterPriority, filterTag]
  );

  // Group by milestone
  const grouped = useMemo(
    () => groupTasksByMilestone(sortItems(filtered, taskAccessors, sortKey, sortDir)),
    [filtered, sortKey, sortDir]
  );

  const totalTasks = filtered.length;
  const { est: totalEstBudget, spent: totalActualSpend, remaining: totalRemaining } = taskBudgetTotals(filtered);

  async function handleInlineUpdate(taskId: string, fields: Record<string, any>) {
    // Clear previous error
    setInlineError("");

    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setUpdatingId(taskId);

    try {
      const res = await clientFetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setInlineError(data.error || `Failed to update ${Object.keys(fields).join(", ")}`);
        setUpdatingId(null);
        return;
      }

      const updated = await res.json();
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...normaliseTaskMoney(updated) } : t));
      setUpdatingId(null);
      router.refresh();
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setInlineError("Network error — please check your connection");
      }
      setUpdatingId(null);
    }
  }

  function openEditor(task: any | null) {
    setEditingTask(task);
    setModalOpen(true);
  }

  async function handleDelete(taskId: string, code: string) {
    if (!await confirmDialog(`Delete task ${code}? This cannot be undone.`)) return;
    const res = await clientFetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) {
      setTasks(prev => prev.filter(t => t.id !== taskId));
    }
  }

  function handleSaved() {
    cf.reload();
    clientFetch("/api/tasks").then(r => {
      // Was a silent `return` plus an empty .catch — a persistent 403 on this
      // endpoint would have looked like "saving does nothing".
      if (!r.ok) throw new Error(`Task refresh failed (${r.status})`);
      r.json().then(({ data }) => {
        if (!data) return;
        setTasks(data.map(normaliseTaskMoney));
      });
    }).catch(err => console.error("Failed to refresh tasks:", err));
  }

  const hasFilters = search || filterStatus || filterMilestone || filterPriority || filterTag;

  return (
    <>
      <Topbar 
        title="Tasks"
        subtitle={`${projectName}: ${totalTasks} task${totalTasks === 1 ? "" : "s"} across ${grouped.length} milestone${grouped.length === 1 ? "" : "s"}`}
        breadcrumbs={[
          { label: projectName, href: "/dashboard" },
          { label: "Tasks" },
        ]}
      />

      <main className="flex-1 overflow-auto p-4 lg:p-8 space-y-5">
        {/* Budget summary */}
        <BudgetSummary est={totalEstBudget} spent={totalActualSpend} remaining={totalRemaining} />

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <label htmlFor="task-search" className="sr-only">Search tasks</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
            <Input
              id="task-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Title or code"
              className="pl-9 rounded-full"
            />
          </div>
          <Select aria-label="Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-36">
            <option value="">All statuses</option>
            {ALL_STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
          <Select aria-label="Priority" value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="w-32">
            <option value="">All priorities</option>
            {ALL_PRIORITIES.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select aria-label="Milestone" value={filterMilestone} onChange={e => setFilterMilestone(e.target.value)} className="w-44">
            <option value="">All milestones</option>
            {milestones.map(m => <option key={m.id} value={m.id}>{m.code}</option>)}
          </Select>
          <Select aria-label="Tag" value={filterTag} onChange={e => setFilterTag(e.target.value)} className="w-40">
            <option value="">All tags</option>
            {tags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterStatus(""); setFilterMilestone(""); setFilterPriority(""); setFilterTag(""); }}>
              Clear
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadCSV(
              toTaskCsvRows(filtered),
              "tasks.csv",
              TASK_CSV_COLUMNS
            )}>
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
            <Button onClick={() => { setEditingTask(null); setModalOpen(true); }} disabled={milestones.length === 0} title={milestones.length === 0 ? "Create a milestone first" : ""}>
              <Plus className="w-4 h-4 mr-1" /> New Task
            </Button>
          </div>
        </div>

        {/* Inline error banner */}
        {inlineError && (
          <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive text-sm text-foreground px-4 py-3 flex items-center justify-between">
            <span><span aria-hidden>▲ </span>{inlineError}</span>
            <button
              onClick={() => setInlineError("")}
              className="text-destructive hover:underline text-sm font-semibold ml-4 min-h-6"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Task groups */}
        {grouped.length === 0 && (
          <EmptyState
            icon={ListChecks}
            title={hasFilters ? "No tasks match these filters" : "No tasks in this project yet"}
            description={hasFilters ? "Try a different search or clear the filters." : "Tasks hang off milestones. Create one to start tracking work and spend."}
          />
        )}

        {grouped.map((group) => (
          <div key={group.id}>
            <button
              type="button"
              aria-expanded={!collapsedMilestones[group.id]}
              className="flex w-full items-center gap-2 px-3 py-2 mt-2 mb-1 min-h-9 text-left hover:bg-accent rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => toggleMilestone(group.id)}
            >
              {collapsedMilestones[group.id] ? (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full tabular-nums">{group.code}</span>
              <span className="text-base font-bold text-foreground">{group.title}</span>
              <span className="text-sm text-muted-foreground ml-1">({group.tasks.length})</span>
            </button>

            {!collapsedMilestones[group.id] && (
              <TaskGroupTable
                group={group}
                customFields={cf}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                updatingId={updatingId}
                onInlineUpdate={handleInlineUpdate}
                onEdit={openEditor}
                onDelete={handleDelete}
              />
            )}
          </div>
        ))}
      </main>

      <TaskModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        task={editingTask}
         milestones={milestones}
         resources={resources}
         costCategories={costCategories}
         tags={tags}
         projectId={projectId}
         onSaved={handleSaved}
       />
    </>
  );
}
