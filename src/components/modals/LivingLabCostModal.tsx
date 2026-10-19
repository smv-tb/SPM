"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { clientFetch } from "@/lib/client-fetch";
import { useCostCategories } from "@/hooks/use-cost-categories";

interface LivingLabCost {
  id: string;
  costCategoryId?: string | null;
  ownerId?: string | null;
  estBudget?: number | string | null;
  actualSpend?: number | string | null;
  startDate?: string | null;
  endDate?: string | null;
}

interface LivingLabCostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labId: string;
  cost?: LivingLabCost | null;
  users: { id: string; name: string }[];
  onSaved: (cost: LivingLabCost, isEdit: boolean) => void;
}

export function LivingLabCostModal({ open, onOpenChange, labId, cost, users, onSaved }: LivingLabCostModalProps) {
  const isEdit = !!cost;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { categories } = useCostCategories((err) => console.error("Failed to fetch categories", err));

  const [form, setForm] = useState({
    costCategoryId: "", ownerId: "", estBudget: "", actualSpend: "", startDate: "", endDate: "",
  });

  useEffect(() => {
    if (cost) {
      setForm({
        costCategoryId: cost.costCategoryId || "",
        ownerId: cost.ownerId || "",
        estBudget: cost.estBudget != null ? String(cost.estBudget) : "",
        actualSpend: cost.actualSpend != null ? String(cost.actualSpend) : "",
        startDate: cost.startDate ? cost.startDate.split("T")[0] : "",
        endDate: cost.endDate ? cost.endDate.split("T")[0] : "",
      });
    } else {
      setForm({ costCategoryId: "", ownerId: "", estBudget: "", actualSpend: "", startDate: "", endDate: "" });
    }
    setError("");
  }, [cost, open]);

  const set = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const payload = {
      costCategoryId: form.costCategoryId || null,
      ownerId: form.ownerId || null,
      estBudget: form.estBudget ? parseFloat(form.estBudget) : 0,
      actualSpend: form.actualSpend ? parseFloat(form.actualSpend) : 0,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    };

    const url = isEdit
      ? `/api/living-labs/${labId}/costs/${cost.id}`
      : `/api/living-labs/${labId}/costs`;
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await clientFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setLoading(false);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save");
        return;
      }

      const saved = await res.json();
      onSaved(saved, isEdit);
      onOpenChange(false);
    } catch {
      setLoading(false);
      setError("Network error — please check your connection");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Cost Item" : "Add Cost Item"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Category *</label>
            <Select value={form.costCategoryId} onChange={e => set("costCategoryId", e.target.value)}>
              <option value="">— Select Category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Owner</label>
            <Select value={form.ownerId} onChange={e => set("ownerId", e.target.value)}>
              <option value="">— Unassigned —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Est. Budget (GBP)</label>
              <Input type="number" step="0.01" value={form.estBudget} onChange={e => set("estBudget", e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Actual Spend (GBP)</label>
              <Input type="number" step="0.01" value={form.actualSpend} onChange={e => set("actualSpend", e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Start Date</label>
              <Input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">End Date</label>
              <Input type="date" value={form.endDate} onChange={e => set("endDate", e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : isEdit ? "Update" : "Add Cost"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
