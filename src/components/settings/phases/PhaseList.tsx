"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit2, GripVertical } from "lucide-react";
import type { Phase } from "./types";

/** Custom field values of each phase, as "Name: value" chips for the phase cards. */
export const PhaseExtraContext = createContext<(phaseId: string) => string[]>(() => []);

function PhaseItemCard({
  phase,
  dragHandle,
  onEdit,
  onDelete,
}: {
  phase: Phase;
  dragHandle: React.ReactNode;
  onEdit?: (phase: Phase) => void;
  onDelete?: (id: string) => void;
}) {
  const chips = useContext(PhaseExtraContext)(phase.id);
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-3">
        {dragHandle}
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: phase.color || "#cbd5e1" }}
        />
        <span className="font-medium">{phase.name}</span>
        <span className="text-xs text-muted-foreground">#{phase.orderIndex}</span>
        {chips.map((c) => (
          <span key={c} className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{c}</span>
        ))}
      </div>
      {onEdit && onDelete && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onEdit(phase)} aria-label={`Edit ${phase.name}`}>
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(phase.id)}
            aria-label={`Delete ${phase.name}`}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SortablePhaseItem({
  phase,
  onEdit,
  onDelete,
}: {
  phase: Phase;
  onEdit: (phase: Phase) => void;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: phase.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <PhaseItemCard
        phase={phase}
        dragHandle={
          <button
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${phase.name}`}
            className="cursor-grab touch-none hover:bg-muted rounded p-1"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </button>
        }
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

export function PhaseList({
  phases,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
  onReorder,
}: {
  phases: Phase[];
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (phase: Phase) => void;
  onDelete: (id: string) => void;
  onReorder: (phases: Phase[]) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = phases.findIndex((p) => p.id === active.id);
      const newIndex = phases.findIndex((p) => p.id === over.id);
      const newPhases = arrayMove(phases, oldIndex, newIndex).map((p, idx) => ({
        ...p,
        orderIndex: idx,
      }));
      onReorder(newPhases);
    }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={onAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Phase
          </Button>
        </div>
      )}

      {phases.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
          No phases defined for this project.
        </div>
      ) : !mounted || !canEdit ? (
        <div className="grid gap-3">
          {phases.map((phase) => (
            <PhaseItemCard
              key={phase.id}
              phase={phase}
              dragHandle={
                <div className="rounded p-1 text-muted-foreground/30">
                  <GripVertical className="w-4 h-4" />
                </div>
              }
              onEdit={canEdit ? onEdit : undefined}
              onDelete={canEdit ? onDelete : undefined}
            />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={phases.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div className="grid gap-3">
              {phases.map((phase) => (
                <SortablePhaseItem
                  key={phase.id}
                  phase={phase}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
