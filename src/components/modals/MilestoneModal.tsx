"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/ui/form-section";
import { clientFetch } from "@/lib/client-fetch";
import { useCustomFieldsForm } from "@/components/ui/custom-fields-form";

interface Milestone {
  id: string;
  code?: string;
  title?: string;
  description?: string;
  phaseId?: string | null;
  parentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  status?: string;
  priority?: string;
  estBudget?: number | string | null;
  updatedAt?: string | Date | null;
}

interface MilestoneModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestone?: Milestone | null;
  phases: { id: string; name: string }[];
  parentMilestones: { id: string; code: string; title: string }[];
  projectId: string;
  onSaved: () => void;
}

const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "BLOCKED", "ON_HOLD"];
const PRIORITIES = ["HIGH", "MED", "LOW"];

export function MilestoneModal({ open, onOpenChange, milestone, phases, parentMilestones, projectId, onSaved }: MilestoneModalProps) {
  const isEdit = !!milestone;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Set when a create saved the record but not its custom fields, so a retry cannot create a second record.
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => setCreatedId(null), [open]);
  const customFields = useCustomFieldsForm({ open, projectId, module: "MILESTONE", entityId: milestone?.id });

  const [form, setForm] = useState({
    code: "", title: "", description: "", phaseId: "", parentId: "",
    startDate: "", dueDate: "", status: "NOT_STARTED", priority: "MED", estBudget: "",
  });

  useEffect(() => {
    if (milestone) {
      setForm({
        code: milestone.code || "",
        title: milestone.title || "",
        description: milestone.description || "",
        phaseId: milestone.phaseId || "",
        parentId: milestone.parentId || "",
        startDate: milestone.startDate?.split("T")[0] || "",
        dueDate: milestone.dueDate?.split("T")[0] || "",
        status: milestone.status || "NOT_STARTED",
        priority: milestone.priority || "MED",
        estBudget: milestone.estBudget != null ? String(milestone.estBudget) : "",
      });
    } else {
      setForm({ code: "", title: "", description: "", phaseId: phases[0]?.id || "", parentId: "", startDate: "", dueDate: "", status: "NOT_STARTED", priority: "MED", estBudget: "" });
    }
    setError("");
  }, [milestone, open, phases]);

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));

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

    const payload = {
      ...form,
      projectId: isEdit ? undefined : projectId,
      phaseId: form.phaseId || null,
      parentId: form.parentId || null,
      estBudget: form.estBudget ? parseFloat(form.estBudget) : null,
      startDate: form.startDate || undefined,
      dueDate: form.dueDate || undefined,
      ...(isEdit && milestone.updatedAt ? {
        updatedAt: typeof milestone.updatedAt === "string"
          ? milestone.updatedAt
          : new Date(milestone.updatedAt).toISOString(),
      } : {}),
    };

    const url = isEdit ? `/api/milestones/${milestone.id}` : "/api/milestones";
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
        const fieldErrors = data.details?.fieldErrors;
        const firstError = fieldErrors
          ? Object.entries(fieldErrors).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("; ")
          : data.error || "Failed to save";
        setError(firstError);
        return;
      }

      // The record is saved by now; custom field values need its id, which a create only returns here.
      const savedId: string | undefined = isEdit ? milestone.id : (await res.json().catch(() => null))?.id;
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Milestone" : "New Milestone"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormSection title="Identity">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Code *</label>
                <Input value={form.code} onChange={e => set("code", e.target.value)} placeholder="M5" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Phase</label>
                <Select value={form.phaseId} onChange={e => set("phaseId", e.target.value)}>
                  <option value="">— None —</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
              <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Milestone title" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Parent Milestone</label>
              <Select value={form.parentId} onChange={e => set("parentId", e.target.value)}>
                <option value="">— Top-level —</option>
                {parentMilestones.filter(m => m.id !== milestone?.id).map(m => <option key={m.id} value={m.id}>{m.code} — {m.title}</option>)}
              </Select>
            </div>
          </FormSection>

          <FormSection title="Schedule & Status">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Start Date *</label>
                <Input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date *</label>
                <Input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                <Select value={form.status} onChange={e => set("status", e.target.value)}>
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
                <label className="block text-xs font-medium text-muted-foreground mb-1">Budget (£)</label>
                <Input type="number" step="0.01" value={form.estBudget} onChange={e => set("estBudget", e.target.value)} placeholder="0.00" />
              </div>
            </div>
          </FormSection>

          <FormSection title="Description">
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional description…" rows={3} />
          </FormSection>

          {customFields.section}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : isEdit ? "Update" : "Create Milestone"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
