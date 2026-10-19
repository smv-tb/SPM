"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState, useEffect, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
import { clientFetch } from "@/lib/client-fetch";
import { formatCurrency } from "@/lib/utils";
import { summarizeTranches, isOverdue } from "@/lib/funding";

type Direction = "INCOMING" | "OUTGOING";

interface Tranche {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  receivedDate: string | null;
  status: "PENDING" | "RECEIVED" | "DELAYED";
  direction: Direction;
}

interface Props {
  fundingRecordId: string;
  // Called after any successful add/receive/delete so the parent (the main
  // funding list, which shows a per-record "received X of Y" summary) can
  // refresh — without this, that summary stays stale until the user submits
  // the whole form or reloads the page.
  onChange?: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-muted text-foreground",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  DELAYED: "bg-red-100 text-red-700",
};

const DIRECTION_META: Record<Direction, { label: string; badge: string; settledLabel: string; actionLabel: string }> = {
  INCOMING: { label: "In", badge: "bg-primary/10 text-primary", settledLabel: "Received", actionLabel: "Mark Received" },
  OUTGOING: { label: "Out", badge: "bg-orange-100 text-orange-700", settledLabel: "Repaid", actionLabel: "Mark Repaid" },
};

export function TrancheSubTable({ fundingRecordId, onChange }: Props) {
  const [tranches, setTranches] = useState<Tranche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newDirection, setNewDirection] = useState<Direction>("INCOMING");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await clientFetch(`/api/funding/${fundingRecordId}/tranches`);
      if (res.ok) {
        const data = await res.json();
        setTranches(data.map((t: Tranche) => ({ ...t, amount: Number(t.amount) })));
      }
    } finally {
      setLoading(false);
    }
  }, [fundingRecordId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFailure(res: Response, fallback: string) {
    const data = await res.json().catch(() => ({}));
    setError(data.error || fallback);
  }

  async function handleAdd() {
    if (!newLabel || !newAmount || !newDueDate) return;
    setError("");
    const res = await clientFetch(`/api/funding/${fundingRecordId}/tranches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel, amount: parseFloat(newAmount), dueDate: newDueDate, direction: newDirection }),
    });
    if (!res.ok) return handleFailure(res, "Failed to add tranche");
    setNewLabel("");
    setNewAmount("");
    setNewDueDate("");
    setNewDirection("INCOMING");
    await load();
    onChange?.();
  }

  async function handleReceive(id: string, direction: Direction) {
    setError("");
    const res = await clientFetch(`/api/funding/tranches/${id}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return handleFailure(res, `Failed to mark tranche as ${DIRECTION_META[direction].settledLabel.toLowerCase()}`);
    await load();
    onChange?.();
  }

  async function handleDelete(id: string) {
    if (!await confirmDialog("Delete this tranche?")) return;
    setError("");
    const res = await clientFetch(`/api/funding/tranches/${id}`, { method: "DELETE" });
    if (!res.ok) return handleFailure(res, "Failed to delete tranche");
    await load();
    onChange?.();
  }

  const summary = summarizeTranches(tranches);
  const hasIncoming = summary.incoming.totalCount > 0;
  const hasOutgoing = summary.outgoing.totalCount > 0;
  const descriptionParts = [
    hasIncoming && `Received ${summary.incoming.receivedCount} of ${summary.incoming.totalCount} (${formatCurrency(summary.incoming.receivedAmount)} of ${formatCurrency(summary.incoming.totalAmount)})`,
    hasOutgoing && `Repaid ${summary.outgoing.receivedCount} of ${summary.outgoing.totalCount} (${formatCurrency(summary.outgoing.receivedAmount)} of ${formatCurrency(summary.outgoing.totalAmount)})`,
  ].filter(Boolean);

  return (
    <FormSection
      title="Tranches"
      description={descriptionParts.length > 0 ? descriptionParts.join(" · ") : "No tranches yet"}
    >
      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1.5">{error}</p>}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          {tranches.map((t) => {
            const dirMeta = DIRECTION_META[t.direction];
            const overdue = t.status !== "RECEIVED" && isOverdue(t.dueDate);
            return (
              <div key={t.id} className="flex items-center gap-2 text-xs border border-border rounded-lg px-2 py-1.5">
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${dirMeta.badge}`}>
                  {dirMeta.label}
                </span>
                <span className="flex-1 truncate">{t.label}</span>
                <span className="font-semibold">{formatCurrency(t.amount)}</span>
                <span className={overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                  {new Date(t.dueDate).toLocaleDateString()}
                </span>
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[t.status]}`}>
                  {t.status === "RECEIVED" ? dirMeta.settledLabel : t.status}
                </span>
                {t.status !== "RECEIVED" && (
                  <button
                    type="button"
                    onClick={() => handleReceive(t.id, t.direction)}
                    className="text-primary text-xs font-semibold hover:underline whitespace-nowrap"
                  >
                    {dirMeta.actionLabel}
                  </button>
                )}
                <button type="button" onClick={() => handleDelete(t.id)} className="text-muted-foreground hover:text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {tranches.length === 0 && <p className="text-xs text-muted-foreground">No tranches yet.</p>}
        </div>
      )}

      <div className="grid grid-cols-[90px_1fr_100px_130px_auto] gap-2 items-end">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Direction</label>
          <Select value={newDirection} onChange={(e) => setNewDirection(e.target.value as Direction)}>
            <option value="INCOMING">Incoming</option>
            <option value="OUTGOING">Outgoing</option>
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Q1 payment" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Amount</label>
          <Input type="number" step="0.01" min="0" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date</label>
          <Input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={handleAdd}>
          Add
        </Button>
      </div>
    </FormSection>
  );
}
