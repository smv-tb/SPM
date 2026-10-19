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
import { FUNDING_STAGES, FUNDING_STAGE_META, type FundingStage } from "@/lib/funding";
import { TrancheSubTable } from "@/components/funding/TrancheSubTable";

interface FundingRecord {
  id: string;
  fundId?: string;
  fundName?: string;
  type?: string;
  section?: string;
  source?: string;
  date?: string | Date | null;
  amount?: number | string;
  currency?: string;
  coverageDesc?: string;
  verified?: boolean;
  notes?: string;
  periodStart?: string | Date | null;
  periodEnd?: string | Date | null;
  phaseId?: string | null;
  stage?: string | null;
  probability?: number | null;
  deadline?: string | Date | null;
  nextAction?: string | null;
  nextActionDate?: string | Date | null;
  contactName?: string | null;
  contactEmail?: string | null;
  funderUrl?: string | null;
}

interface FundingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record?: FundingRecord | null;
  projectId: string;
  phases?: { id: string; name: string }[];
  onSaved: () => void;
}

const TYPES = ["BOOTSTRAP", "GRANT", "INVESTMENT", "REVENUE", "OTHER"];
const SECTIONS = ["FOUNDER", "LIVE", "PIPELINE"];

function toDateInput(d: string | Date | null | undefined): string {
  return d ? new Date(d).toISOString().split("T")[0] : "";
}

const emptyForm = {
  fundId: "", fundName: "", type: "GRANT", section: "LIVE", source: "",
  date: "", amount: "", currency: "GBP", coverageDesc: "", verified: false, notes: "",
  periodStart: "", periodEnd: "", phaseId: "",
  stage: "", probability: "", deadline: "", nextAction: "", nextActionDate: "",
  contactName: "", contactEmail: "", funderUrl: "",
};

export function FundingModal({ open, onOpenChange, record, projectId, phases = [], onSaved }: FundingModalProps) {
  const isEdit = !!record;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Set when a create saved the record but not its custom fields, so a retry cannot create a second record.
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => setCreatedId(null), [open]);
  const customFields = useCustomFieldsForm({ open, projectId, module: "FUNDING_RECORD", entityId: record?.id });

  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (record) {
      setForm({
        fundId: record.fundId || "",
        fundName: record.fundName || "",
        type: record.type || "GRANT",
        section: record.section || "LIVE",
        source: record.source || "",
        date: toDateInput(record.date),
        amount: record.amount != null ? String(record.amount) : "",
        currency: record.currency || "GBP",
        coverageDesc: record.coverageDesc || "",
        verified: record.verified || false,
        notes: record.notes || "",
        periodStart: toDateInput(record.periodStart),
        periodEnd: toDateInput(record.periodEnd),
        phaseId: record.phaseId || "",
        stage: record.stage || "",
        probability: record.probability != null ? String(record.probability) : "",
        deadline: toDateInput(record.deadline),
        nextAction: record.nextAction || "",
        nextActionDate: toDateInput(record.nextActionDate),
        contactName: record.contactName || "",
        contactEmail: record.contactEmail || "",
        funderUrl: record.funderUrl || "",
      });
    } else {
      setForm(emptyForm);
    }
    setError("");
  }, [record, open]);

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));

  function handleStageChange(newStage: string) {
    const meta = FUNDING_STAGE_META[newStage as FundingStage];
    setForm(f => ({
      ...f,
      stage: newStage,
      probability: meta ? String(meta.defaultProbability) : f.probability,
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
      amount: parseFloat(form.amount) || 0,
      date: form.date ? new Date(form.date) : null,
      periodStart: form.periodStart ? new Date(form.periodStart) : null,
      periodEnd: form.periodEnd ? new Date(form.periodEnd) : null,
      phaseId: form.phaseId || null,
      stage: form.section === "PIPELINE" && form.stage ? form.stage : null,
      probability: form.section === "PIPELINE" && form.probability !== "" ? parseInt(form.probability, 10) : null,
      deadline: form.section === "PIPELINE" && form.deadline ? new Date(form.deadline) : null,
      nextAction: form.section === "PIPELINE" && form.nextAction ? form.nextAction : null,
      nextActionDate: form.section === "PIPELINE" && form.nextActionDate ? new Date(form.nextActionDate) : null,
      contactName: form.section === "PIPELINE" && form.contactName ? form.contactName : null,
      contactEmail: form.section === "PIPELINE" && form.contactEmail ? form.contactEmail : null,
      funderUrl: form.section === "PIPELINE" && form.funderUrl ? form.funderUrl : null,
    };
    const url = isEdit ? `/api/funding/${record.id}` : "/api/funding";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await clientFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setLoading(false);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.details?.fieldErrors) {
          const fieldErrors = data.details.fieldErrors as Record<string, string[]>;
          const msgs = Object.entries(fieldErrors)
            .filter(([, errs]) => errs.length > 0)
            .map(([field, errs]) => `${field}: ${errs.join(", ")}`);
          setError(msgs.join("; "));
        } else {
          setError(data.error || "Failed to save");
        }
        return;
      }

      // The record is saved by now; custom field values need its id, which a create only returns here.
      const savedId: string | undefined = isEdit ? record.id : (await res.json().catch(() => null))?.id;
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
          <DialogTitle>{isEdit ? "Edit Funding Record" : "New Funding Record"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormSection title="Identity">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Fund ID *</label>
                <Input value={form.fundId} onChange={e => set("fundId", e.target.value)} placeholder="F006" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Section *</label>
                <Select value={form.section} onChange={e => set("section", e.target.value)}>
                  {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Fund Name *</label>
              <Input value={form.fundName} onChange={e => set("fundName", e.target.value)} placeholder="e.g. Innovate UK Grant" required />
            </div>
          </FormSection>

          <FormSection title="Source & Amount">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Type *</label>
                <Select value={form.type} onChange={e => set("type", e.target.value)}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Source *</label>
                <Input value={form.source} onChange={e => set("source", e.target.value)} placeholder="e.g. Innovate UK" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
                <Input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Amount (£) *</label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="0.00" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Currency</label>
                <Input value={form.currency} onChange={e => set("currency", e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" id="verified" checked={form.verified} onChange={e => set("verified", e.target.checked)} className="rounded border-border" />
                <label htmlFor="verified" className="text-xs text-muted-foreground">Verified / Confirmed</label>
              </div>
            </div>
          </FormSection>

          <FormSection title="Period & Phase">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Period Start</label>
                <Input type="date" value={form.periodStart} onChange={e => set("periodStart", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Period End</label>
                <Input type="date" value={form.periodEnd} onChange={e => set("periodEnd", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Phase</label>
              <Select value={form.phaseId} onChange={e => set("phaseId", e.target.value)}>
                <option value="">None</option>
                {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
          </FormSection>

          {form.section === "PIPELINE" && (
            <FormSection title="Pipeline details">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Stage</label>
                  <Select value={form.stage} onChange={e => handleStageChange(e.target.value)}>
                    <option value="">—</option>
                    {FUNDING_STAGES.map(s => <option key={s} value={s}>{FUNDING_STAGE_META[s].label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Probability (%)</label>
                  <Input type="number" min="0" max="100" value={form.probability} onChange={e => set("probability", e.target.value)} placeholder="0-100" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Deadline</label>
                <Input type="date" value={form.deadline} onChange={e => set("deadline", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Next Action</label>
                  <Input value={form.nextAction} onChange={e => set("nextAction", e.target.value)} placeholder="e.g. Submit final report" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Next Action Date</label>
                  <Input type="date" value={form.nextActionDate} onChange={e => set("nextActionDate", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Contact Name</label>
                  <Input value={form.contactName} onChange={e => set("contactName", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Contact Email</label>
                  <Input type="email" value={form.contactEmail} onChange={e => set("contactEmail", e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Funder URL</label>
                <Input type="url" value={form.funderUrl} onChange={e => set("funderUrl", e.target.value)} placeholder="https://…" />
              </div>
            </FormSection>
          )}

          <FormSection title="Details">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">What it covers</label>
              <Textarea value={form.coverageDesc} onChange={e => set("coverageDesc", e.target.value)} placeholder="Description of what this funding covers…" rows={2} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Additional notes…" rows={2} />
            </div>
          </FormSection>

          {isEdit && record && <TrancheSubTable fundingRecordId={record.id} onChange={onSaved} />}

          {customFields.section}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : isEdit ? "Update" : "Add Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
