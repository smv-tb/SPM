"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { clientFetch } from "@/lib/client-fetch";
import { useCustomFieldColumns } from "@/components/ui/custom-field-columns";
import { PhaseForm, type PhaseFormValues } from "./PhaseForm";
import { PhaseList, PhaseExtraContext } from "./PhaseList";
import type { Phase } from "./types";

export function PhasesManager({ projectId, phases, canEdit }: { projectId: string; phases: Phase[]; canEdit: boolean }) {
  const router = useRouter();
  const [isPhaseModalOpen, setIsPhaseModalOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<Phase | null>(null);
  const cf = useCustomFieldColumns(projectId, "PHASE");
  const chipsFor = (phaseId: string) =>
    cf.columns.map((c) => [c.name, cf.cell(phaseId, c)]).filter(([, v]) => v !== "—").map(([n, v]) => `${n}: ${v}`);

  const handlePhaseSave = async (data: PhaseFormValues) => {
    const method = editingPhase ? "PATCH" : "POST";
    const body = editingPhase ? { id: editingPhase.id, ...data } : { projectId, ...data, orderIndex: phases.length };
    const res = await clientFetch("/api/phases", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to save phase");
    const saved = await res.json().catch(() => null);
    toast.success(editingPhase ? "Phase updated" : "Phase added");
    cf.reload();
    router.refresh();
    return saved?.id as string | undefined;
  };

  const handlePhaseDelete = async (id: string) => {
    if (!await confirmDialog("Delete this phase? Milestones and funding records in it are kept but lose their phase.")) return;
    const res = await clientFetch(`/api/phases?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete phase");
      return;
    }
    toast.success("Phase deleted");
    router.refresh();
  };

  const handleReorderPhases = useCallback(async (newPhases: Phase[]) => {
    const res = await clientFetch("/api/phases/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phases: newPhases.map((p) => ({ id: p.id, orderIndex: p.orderIndex })) }),
    });
    if (!res.ok) {
      toast.error("Failed to reorder phases");
      return;
    }
    toast.success("Phases reordered");
    router.refresh();
  }, [router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Phases</CardTitle>
      </CardHeader>
      <CardContent>
        <PhaseExtraContext.Provider value={chipsFor}>
        <PhaseList
          phases={phases}
          canEdit={canEdit}
          onAdd={() => { setEditingPhase(null); setIsPhaseModalOpen(true); }}
          onEdit={(phase) => { setEditingPhase(phase); setIsPhaseModalOpen(true); }}
          onDelete={handlePhaseDelete}
          onReorder={handleReorderPhases}
        />
        </PhaseExtraContext.Provider>
      </CardContent>
      <PhaseForm
        open={isPhaseModalOpen}
        onOpenChange={(open) => {
          setIsPhaseModalOpen(open);
          if (!open) setEditingPhase(null);
        }}
        initialData={editingPhase || undefined}
        projectId={projectId}
        onSave={handlePhaseSave}
      />
    </Card>
  );
}
