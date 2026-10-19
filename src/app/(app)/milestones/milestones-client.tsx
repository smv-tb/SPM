"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Card } from "@/components/ui/card";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MilestoneModal } from "@/components/modals/MilestoneModal";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate, daysUntil } from "@/lib/utils";
import { useCustomFieldColumns } from "@/components/ui/custom-field-columns";
import { Plus, ChevronRight, Pencil, Trash2, Milestone, Search, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { clientFetch } from "@/lib/client-fetch";

interface Props {
  milestones: any[];
  allMilestones: { id: string; code: string; title: string }[];
  phases: { id: string; name: string }[];
  projectId: string;
}

const ALL_MILESTONE_STATUSES = ["", "NOT_STARTED", "IN_PROGRESS", "COMPLETE", "BLOCKED", "ON_HOLD"];
const ALL_MILESTONE_PRIORITIES = ["", "HIGH", "MED", "LOW"];
const SORT_OPTIONS = [
  { value: "dueDate-asc", label: "Due Date ↑" },
  { value: "dueDate-desc", label: "Due Date ↓" },
  { value: "startDate-asc", label: "Start Date ↑" },
  { value: "startDate-desc", label: "Start Date ↓" },
  { value: "title-asc", label: "Title A–Z" },
  { value: "title-desc", label: "Title Z–A" },
];

export function MilestonesClient({ milestones, allMilestones, phases, projectId }: Props) {
  const router = useRouter();
  const cf = useCustomFieldColumns(projectId, "MILESTONE");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMs, setEditingMs] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [sortValue, setSortValue] = useState("dueDate-asc");

  const filteredMilestones = useMemo(() => {
    let result = milestones.filter(m => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !m.title?.toLowerCase().includes(q) &&
          !m.code?.toLowerCase().includes(q) &&
          !m.description?.toLowerCase().includes(q)
        ) return false;
      }
      if (filterStatus && m.status !== filterStatus) return false;
      if (filterPriority && m.priority !== filterPriority) return false;
      return true;
    });

    const [field, dir] = sortValue.split("-") as [string, string];
    if (field) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (field === "dueDate") {
          const aD = a.dueDate ? new Date(a.dueDate).getTime() : 0;
          const bD = b.dueDate ? new Date(b.dueDate).getTime() : 0;
          const aNull = a.dueDate == null ? 1 : 0;
          const bNull = b.dueDate == null ? 1 : 0;
          cmp = aNull - bNull || aD - bD;
        } else if (field === "startDate") {
          const aD = a.startDate ? new Date(a.startDate).getTime() : 0;
          const bD = b.startDate ? new Date(b.startDate).getTime() : 0;
          const aNull = a.startDate == null ? 1 : 0;
          const bNull = b.startDate == null ? 1 : 0;
          cmp = aNull - bNull || aD - bD;
        } else if (field === "title") {
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
        }
        return dir === "desc" ? -cmp : cmp;
      });
    }

    return result;
  }, [milestones, search, filterStatus, filterPriority, sortValue]);

  const hasFilters = search || filterStatus || filterPriority;

  function handleSaved() {
    cf.reload();
    router.refresh();
  }

  async function handleDelete(id: string, title: string) {
    if (!await confirmDialog(`Delete "${title}"? This will also remove all tasks under this milestone.`)) return;
    try {
      const res = await clientFetch(`/api/milestones/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete milestone");
        return;
      }
      toast.success("Milestone deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete milestone");
    }
  }

  return (
    <>
      <Topbar 
        title="Milestones" 
        subtitle={hasFilters ? `${filteredMilestones.length} of ${milestones.length} milestones` : `${milestones.length} top-level milestones`}
        breadcrumbs={[
          { label: "Milestones", href: "/milestones" }
        ]}
      />

      <main className="flex-1 overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search milestones…"
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-36">
              <option value="">All Status</option>
              {ALL_MILESTONE_STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
            <Select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="w-32">
              <option value="">All Priority</option>
              {ALL_MILESTONE_PRIORITIES.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
            <div className="flex items-center gap-1">
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
              <Select value={sortValue} onChange={e => setSortValue(e.target.value)} className="w-36">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterStatus(""); setFilterPriority(""); }}>
                Clear
              </Button>
            )}
          </div>
          <Button onClick={() => { setEditingMs(null); setModalOpen(true); }} className="shrink-0">
            <Plus className="w-4 h-4 mr-1" /> New Milestone
          </Button>
        </div>

        {filteredMilestones.length === 0 && milestones.length > 0 && (
          <EmptyState
            icon={Milestone}
            title="No milestones match your filters"
            description="Try adjusting your search or filters."
          />
        )}

        {milestones.length === 0 && (
          <EmptyState
            icon={Milestone}
            title="No milestones yet"
            description="Create your first milestone to start tracking project progress."
          />
        )}

        {filteredMilestones.map((m) => {
          const allTasks = [...m.tasks, ...m.children.flatMap((c: any) => c.tasks)];
          const taskCount = allTasks.length;
          const pct = taskCount > 0 ? Math.round(allTasks.reduce((s: number, t: any) => s + t.percentDone, 0) / taskCount) : 0;
          const isComplete = m.status === "COMPLETE";
          const days = isComplete ? null : daysUntil(new Date(m.dueDate));

          return (
            <Card key={m.id} className="overflow-hidden">
              {/* Milestone header — wraps on narrow screens */}
              <div className="p-4 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-mono text-xs bg-secondary text-muted-foreground px-2 py-1 rounded shrink-0">{m.code}</span>
                    <Link href={`/milestones/${m.id}`} className="font-semibold text-foreground hover:text-primary truncate">{m.title}</Link>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => { setEditingMs(m); setModalOpen(true); }} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(m.id, m.title)} className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <Link href={`/milestones/${m.id}`} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
                {/* Meta row — badges, budget, date */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <StatusBadge status={m.status} size="sm" />
                  <PriorityBadge priority={m.priority} size="sm" />
                  {m.phase && <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{m.phase.name}</span>}
                  <span className="text-xs font-medium text-foreground">{formatCurrency(m.estBudget ?? 0)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(new Date(m.dueDate))}</span>
                  {cf.columns.map(c => {
                    const v = cf.cell(m.id, c);
                    return v === "—" ? null : <span key={c.id} className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{c.name}: {v}</span>;
                  })}
                  {isComplete ? (
                    <span className="text-xs font-medium text-emerald-600">Complete</span>
                  ) : days != null && (
                    <span className={`text-xs font-medium ${days < 0 ? "text-red-600" : days < 14 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="px-4 py-2.5 bg-secondary/30 flex items-center gap-3">
                <Progress value={pct} className="flex-1" showLabel />
                <span className="text-xs text-muted-foreground shrink-0">
                  {allTasks.filter((t: any) => t.status === "DONE").length}/{taskCount} tasks done
                </span>
              </div>

                {/* Sub-milestones */}
                {m.children.length > 0 && (
                  <div className="divide-y divide-border">
                    {m.children.map((child: any) => {
                      const childPct = child.tasks.length > 0
                        ? Math.round(child.tasks.reduce((s: number, t: any) => s + t.percentDone, 0) / child.tasks.length)
                        : 0;
                      const childIsComplete = child.status === "COMPLETE";
                      const childDays = childIsComplete ? null : daysUntil(new Date(child.dueDate));
                      return (
                        <div key={child.id} className="px-4 py-2.5 hover:bg-muted/20 transition-colors">
                          <div className="flex items-center gap-3">
                            <span className="w-4" />
                            <span className="font-mono text-xs text-muted-foreground shrink-0">{child.code}</span>
                            <Link href={`/milestones/${child.id}`} className="text-sm text-foreground hover:text-primary truncate flex-1 min-w-0">
                              {child.title}
                            </Link>
                            <StatusBadge status={child.status} size="sm" />
                            <button
                              onClick={() => {
                                setEditingMs(child);
                                setModalOpen(true);
                              }}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(child.id, child.title)}
                              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            {childIsComplete ? (
                              <span className="text-xs shrink-0 text-emerald-600">Complete</span>
                            ) : childDays != null && (
                              <span className={`text-xs shrink-0 ${childDays < 0 ? "text-red-600" : childDays < 14 ? "text-amber-600" : "text-muted-foreground"}`}>
                                {childDays < 0 ? `${Math.abs(childDays)}d over` : `${childDays}d`}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-7 mt-1">
                            <Progress value={childPct} className="w-32" />
                            <span className="text-xs text-muted-foreground">{childPct}%</span>
                            <span className="text-xs text-muted-foreground">{formatDate(new Date(child.dueDate))}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </Card>
          );
        })}
      </main>

      <MilestoneModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        milestone={editingMs}
        phases={phases}
        parentMilestones={allMilestones}
        projectId={projectId}
        onSaved={handleSaved}
      />
    </>
  );
}
