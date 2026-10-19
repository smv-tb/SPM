"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { TagPicker } from "@/components/ui/tag-picker";
import { clientFetch } from "@/lib/client-fetch";
import { useCustomFieldsForm } from "@/components/ui/custom-fields-form";

interface ResourceMilestone {
  milestoneId: string;
}

interface Resource {
  id: string;
  name?: string;
  role?: string;
  department?: string;
  type?: string;
  availability?: string;
  dayRate?: number | string | null;
  daysPerMonth?: number | string | null;
  yearlyCost?: number | string | null;
  status?: string;
  notes?: string;
  resourceMilestones?: ResourceMilestone[];
  resourceTags?: { tag: { id: string } }[];
}

interface ResourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: Resource | null;
  milestones: { id: string; code: string; title: string }[];
  projectId: string;
  tags: { id: string; name: string; color: string }[];
  onSaved: () => void;
}

const TYPES = ["CORE", "PARTNER", "HIRING"];
const STATUSES = ["ACTIVE", "BLOCKED", "INACTIVE"];

export function ResourceModal({ open, onOpenChange, resource, milestones, projectId, tags, onSaved }: ResourceModalProps) {
  const isEdit = !!resource;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Set when a create saved the record but not its custom fields, so a retry cannot create a second record.
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => setCreatedId(null), [open]);
  const customFields = useCustomFieldsForm({ open, projectId, module: "RESOURCE", entityId: resource?.id });

  const [form, setForm] = useState({
    name: "", role: "", department: "", type: "CORE", availability: "",
    dayRate: "", daysPerMonth: "", yearlyCost: "", status: "ACTIVE", notes: "",
    milestoneIds: [] as string[],
    tagIds: [] as string[],
  });

  useEffect(() => {
    if (resource) {
      setForm({
        name: resource.name || "",
        role: resource.role || "",
        department: resource.department || "",
        type: resource.type || "CORE",
        availability: resource.availability || "",
        dayRate: resource.dayRate != null ? String(resource.dayRate) : "",
        daysPerMonth: resource.daysPerMonth != null ? String(resource.daysPerMonth) : "",
        yearlyCost: resource.yearlyCost != null ? String(resource.yearlyCost) : "",
        status: resource.status || "ACTIVE",
        notes: resource.notes || "",
        milestoneIds: resource.resourceMilestones?.map((rm: ResourceMilestone) => rm.milestoneId) || [],
        tagIds: (resource as any).resourceTags?.map((rt: any) => rt.tag.id) || [],
      });
    } else {
      setForm({
        name: "", role: "", department: "", type: "CORE", availability: "",
        dayRate: "", daysPerMonth: "", yearlyCost: "", status: "ACTIVE", notes: "",
        milestoneIds: [],
        tagIds: [],
      });
    }
    setError("");
  }, [resource, open]);

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));

  function toggleMilestone(id: string) {
    setForm(f => ({
      ...f,
      milestoneIds: f.milestoneIds.includes(id)
        ? f.milestoneIds.filter(m => m !== id)
        : [...f.milestoneIds, id],
    }));
  }

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
      projectId,
      tagIds: form.tagIds,
      dayRate: form.dayRate ? parseFloat(form.dayRate) : null,
      daysPerMonth: form.daysPerMonth ? parseInt(form.daysPerMonth) : null,
      yearlyCost: form.yearlyCost ? parseFloat(form.yearlyCost) : null,
    };

    const url = isEdit ? `/api/resources/${resource.id}` : "/api/resources";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await clientFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setLoading(false);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save");
        return;
      }

      // The record is saved by now; custom field values need its id, which a create only returns here.
      const savedId: string | undefined = isEdit ? resource.id : (await res.json().catch(() => null))?.id;
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
          <DialogTitle>{isEdit ? "Edit Resource" : "New Resource"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
              <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. John Doe" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Role *</label>
              <Input value={form.role} onChange={e => set("role", e.target.value)} placeholder="e.g. Senior Developer" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Type</label>
              <Select value={form.type} onChange={e => set("type", e.target.value)}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Status</label>
              <Select value={form.status} onChange={e => set("status", e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Department</label>
            <Input value={form.department} onChange={e => set("department", e.target.value)} placeholder="e.g. Engineering" />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Availability</label>
            <Input value={form.availability} onChange={e => set("availability", e.target.value)} placeholder="e.g. Full-time, 3 days/week" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Day Rate (GBP)</label>
              <Input type="number" step="0.01" value={form.dayRate} onChange={e => set("dayRate", e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Days/Month</label>
              <Input type="number" value={form.daysPerMonth} onChange={e => set("daysPerMonth", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Yearly Cost (GBP)</label>
              <Input type="number" step="0.01" value={form.yearlyCost} onChange={e => set("yearlyCost", e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {milestones.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Assigned Milestones</label>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border rounded-lg p-2">
                {milestones.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMilestone(m.id)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      form.milestoneIds.includes(m.id)
                        ? "bg-primary/10 text-primary border-primary"
                        : "bg-gray-50 text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {m.code}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tags</label>
            <TagPicker
              tags={tags}
              selectedIds={form.tagIds}
              onChange={(ids) => set("tagIds", ids)}
              projectId={projectId}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Additional notes..." />
          </div>

          {customFields.section}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : isEdit ? "Update" : "Add Resource"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
