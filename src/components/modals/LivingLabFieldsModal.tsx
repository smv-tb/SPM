"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCustomFieldsForm } from "@/components/ui/custom-fields-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lab: { id: string; name: string } | null;
  projectId: string;
  onSaved: () => void;
}

/** Living labs have no edit form of their own, so their custom fields get this one. */
export function LivingLabFieldsModal({ open, onOpenChange, lab, projectId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const customFields = useCustomFieldsForm({ open, projectId, module: "LIVING_LAB", entityId: lab?.id });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lab) return;
    const missing = customFields.validate();
    if (missing) {
      setError(missing);
      return;
    }
    setSaving(true);
    setError("");
    const fieldError = await customFields.save(lab.id);
    setSaving(false);
    if (fieldError) {
      setError(fieldError);
      return;
    }
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lab?.name} — custom fields</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          {customFields.section}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
