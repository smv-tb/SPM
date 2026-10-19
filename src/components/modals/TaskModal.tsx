"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/ui/form-section";
import { TagPicker } from "@/components/ui/tag-picker";
import { clientFetch } from "@/lib/client-fetch";
import { useCustomFieldsForm } from "@/components/ui/custom-fields-form";
import { percentDoneForStatus } from "@/lib/utils";

interface CostCategory {
  id: string;
  name: string;
}

interface Task {
  id: string;
  code?: string;
  title?: string;
  milestoneId?: string;
  milestone?: { id: string } | null;
  resourceId?: string | null;
  startDate?: string | Date | null;
  dueDate?: string | Date | null;
  status?: string;
  priority?: string;
  percentDone?: number;
  estBudget?: number | string | null;
  actualSpend?: number | string | null;
  extCosts?: number | string | null;
  costCategoryId?: string | null;
  notes?: string | null;
  updatedAt?: string | Date | null;
}

interface TaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  milestones: { id: string; code: string; title: string }[];
  resources: { id: string; name: string }[];
  costCategories: CostCategory[];
  tags?: { id: string; name: string; color: string }[];
  projectId?: string;
  onSaved: () => void;
}

const STATUSES = ["BACKLOG", "IN_PROGRESS", "DONE", "BLOCKED", "ON_HOLD", "OVERDUE"];
const PRIORITIES = ["HIGH", "MED", "LOW"];

export function TaskModal({ open, onOpenChange, task, milestones, resources, costCategories, tags, projectId, onSaved }: TaskModalProps) {
  const isEdit = !!task;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Set when a create saved the record but not its custom fields, so a retry cannot create a second record.
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => setCreatedId(null), [open]);
  const customFields = useCustomFieldsForm({ open, projectId, module: "TASK", entityId: task?.id });

  const [form, setForm] = useState({
    code: "", title: "", milestoneId: "", resourceId: "", startDate: "", dueDate: "",
    status: "BACKLOG", priority: "MED", percentDone: 0,
    estBudget: "", actualSpend: "", extCosts: "", costCategoryId: "", notes: "",
    tagIds: [] as string[],
  });

  useEffect(() => {
    if (task) {
      setForm({
        code: task.code || "",
        title: task.title || "",
        milestoneId: task.milestoneId || task.milestone?.id || "",
        resourceId: task.resourceId || "",
        startDate: task.startDate ? new Date(task.startDate).toISOString().split("T")[0] : "",
        dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : "",
        status: task.status || "BACKLOG",
        priority: task.priority || "MED",
        percentDone: task.percentDone || 0,
        estBudget: task.estBudget != null ? String(task.estBudget) : "",
        actualSpend: task.actualSpend != null ? String(task.actualSpend) : "",
        extCosts: task.extCosts != null ? String(task.extCosts) : "",
        costCategoryId: task.costCategoryId || "",
        notes: task.notes || "",
        tagIds: (task as any).taskTags?.map((tt: any) => tt.tag.id) || [],
      });
    } else {
      setForm({ code: "", title: "", milestoneId: milestones[0]?.id || "", resourceId: "", startDate: "", dueDate: "", status: "BACKLOG", priority: "MED", percentDone: 0, estBudget: "", actualSpend: "", extCosts: "", costCategoryId: "", notes: "", tagIds: [] });
    }
    setError("");
  }, [task, open, milestones]);

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));

  const setStatus = (status: string) =>
    setForm(f => ({ ...f, status, percentDone: percentDoneForStatus(status, f.percentDone) }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missingField = customFields.validate();
    if (missingField) {
      setError(missingField);
      return;
    }
    if (createdId) {
      setLoading(true);
      const retryError = await customFields.save(createdId);
      setLoading(false);
      if (retryError) {
        setError(`Saved, but the custom fields were not: ${retryError}`);
        return;
      }
      onOpenChange(false);
      return;
    }
    setLoading(true);
    setError("");

    const payload: Record<string, unknown> = {
      milestoneId: form.milestoneId,
      title: form.title,
      status: form.status,
      priority: form.priority,
      percentDone: Number(form.percentDone),
      estBudget: form.estBudget ? parseFloat(form.estBudget) : null,
      actualSpend: form.actualSpend ? parseFloat(form.actualSpend) : null,
      extCosts: form.extCosts ? parseFloat(form.extCosts) : null,
      resourceId: form.resourceId || null,
      costCategoryId: form.costCategoryId || null,
      tagIds: form.tagIds,
    };

    // Optimistic concurrency: send updatedAt for conflict detection
    if (isEdit && task.updatedAt) {
      payload.updatedAt = typeof task.updatedAt === "string"
        ? task.updatedAt
        : new Date(task.updatedAt).toISOString();
    };

    // Only send code if user typed one (server auto-generates otherwise)
    if (form.code?.trim()) payload.code = form.code.trim();

    // Strip empty strings so Zod doesn't fail on optional fields
    if (form.startDate) payload.startDate = form.startDate;
    if (form.dueDate) payload.dueDate = form.dueDate;
    if (form.notes?.trim()) payload.notes = form.notes.trim();
    else payload.notes = null;

    const url = isEdit ? `/api/tasks/${task.id}` : "/api/tasks";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await clientFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

      setLoading(false);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.code === "CONFLICT") {
          setError("This was modified by someone else. Please refresh and try again.");
          return;
        }
        setError(data.error || "Failed to save");
        return;
      }

      // The record is saved by now; custom field values need its id, which a create only returns here.
      const savedId: string | undefined = isEdit ? task.id : (await res.json().catch(() => null))?.id;
      const fieldError = savedId ? await customFields.save(savedId) : null;
      onSaved();
      if (fieldError) {
        if (!isEdit && savedId) setCreatedId(savedId);
        setError(`Saved, but the custom fields were not: ${fieldError}`);
        return;
      }
      onOpenChange(false);
    } catch {
      setLoading(false);
      setError("Network error — please check your connection");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Task" : "New Task"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormSection title="Identity">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Milestone *</label>
              <Select value={form.milestoneId} onChange={e => set("milestoneId", e.target.value)} required>
                {milestones.map(m => <option key={m.id} value={m.id}>{m.code} — {m.title}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Owner (Resource)</label>
              <Select value={form.resourceId} onChange={e => set("resourceId", e.target.value)}>
                <option value="">None</option>
                {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
              <Input data-testid="task-title-input" value={form.title} onChange={e => set("title", e.target.value)} placeholder="Task title" required />
            </div>
          </FormSection>

          <FormSection title="Schedule & Status">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Start Date</label>
                <Input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date</label>
                <Input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                <Select data-testid="task-status-select" value={form.status} onChange={e => setStatus(e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
                <Select value={form.priority} onChange={e => set("priority", e.target.value)}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">% Done</label>
                <div
                  data-testid="percent-done-display"
                  className="w-full h-10 flex items-center px-3 rounded-lg border border-input bg-muted text-sm text-foreground font-medium"
                >
                  {form.percentDone}%
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection title="Budget">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Est. Budget (£)</label>
                <Input type="number" step="0.01" value={form.estBudget} onChange={e => set("estBudget", e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Actual Spend (£)</label>
                <Input type="number" step="0.01" value={form.actualSpend} onChange={e => set("actualSpend", e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Ext. Costs (£)</label>
                <Input type="number" step="0.01" value={form.extCosts} onChange={e => set("extCosts", e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Cost Category</label>
              <Select value={form.costCategoryId} onChange={e => set("costCategoryId", e.target.value)}>
                <option value="">— Select Category —</option>
                {costCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </FormSection>

          <FormSection title="Notes">
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Additional notes…" rows={3} />
          </FormSection>

          {tags && projectId && (
            <FormSection title="Tags">
              <TagPicker
                tags={tags}
                selectedIds={form.tagIds}
                onChange={(ids) => set("tagIds", ids)}
                projectId={projectId}
              />
            </FormSection>
          )}

          {customFields.section}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : isEdit ? "Update Task" : "Create Task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
