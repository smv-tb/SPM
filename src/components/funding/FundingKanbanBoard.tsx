"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { PIPELINE_STAGES, FUNDING_STAGE_META, type FundingStage } from "@/lib/funding";
import { formatCurrency } from "@/lib/utils";
import { FundingKanbanCard, type PipelineRecord } from "./FundingKanbanCard";

interface StageTotals {
  count: number;
  totalAmount: number;
  weightedAmount: number;
}

export interface FundingForecast {
  weightedForecast: number;
  totalPipeline: number;
  byStage: Record<string, StageTotals>;
}

interface Props {
  records: PipelineRecord[];
  forecast: FundingForecast | null;
  onCardClick: (record: PipelineRecord) => void;
  onStageChange: (id: string, stage: FundingStage) => void;
}

export function FundingKanbanBoard({ records, forecast, onCardClick, onStageChange }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeRecord = activeId ? records.find((r) => r.id === activeId) ?? null : null;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const record = records.find((r) => r.id === active.id);
    const newStage = over.id as FundingStage;
    if (record && record.stage !== newStage) {
      onStageChange(String(active.id), newStage);
    }
  }

  // A pipeline record with no stage is shown in PROSPECT rather than nowhere.
  // Dragging it out persists a real stage, so the placeholder self-heals.
  const stageOf = (r: PipelineRecord): FundingStage => (r.stage as FundingStage) ?? "PROSPECT";

  // Guarded deliberately: `Object.values(forecast.byStage)` throws outright if
  // the forecast payload arrives without byStage, and a throw here unmounts the
  // whole page, not just the board. An unusable forecast must degrade to
  // "no per-stage totals", never to a blank Pipeline tab.
  const byStage = forecast?.byStage;
  const forecastCount =
    byStage && typeof byStage === "object"
      ? Object.values(byStage).reduce((s, b) => s + (b?.count ?? 0), 0)
      : null;
  const isFiltered = forecastCount !== null && records.length !== forecastCount;

  return (
    <div className="space-y-4">
      {forecast && typeof forecast.weightedForecast === "number" && (
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-surface-container-lowest p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Weighted Forecast{isFiltered ? " · all pipeline" : ""}
            </p>
            <p className="text-xl font-extrabold mt-1">{formatCurrency(forecast.weightedForecast)}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface-container-lowest p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Total Pipeline{isFiltered ? " · all pipeline" : ""}
            </p>
            <p className="text-xl font-extrabold mt-1">{formatCurrency(forecast.totalPipeline)}</p>
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PIPELINE_STAGES.map((stage) => (
            <FundingKanbanColumn
              key={stage}
              stage={stage}
              records={records.filter((r) => stageOf(r) === stage)}
              // Column headers must describe the cards underneath them. The
              // server forecast covers the whole pipeline, so once a filter is
              // active it would claim "8 · £400k" over two visible cards.
              stageTotals={isFiltered ? undefined : byStage?.[stage]}
              onCardClick={onCardClick}
            />
          ))}
        </div>
        <DragOverlay>
          {activeRecord ? (
            <FundingKanbanCard record={activeRecord} onClick={() => {}} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function FundingKanbanColumn({
  stage,
  records,
  stageTotals,
  onCardClick,
}: {
  stage: FundingStage;
  records: PipelineRecord[];
  stageTotals?: StageTotals;
  onCardClick: (record: PipelineRecord) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = FUNDING_STAGE_META[stage];
  const isTerminalCol = stage === "REJECTED";

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 rounded-xl border p-3 flex flex-col gap-2 min-h-[220px] transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-surface-container-low/40"
      } ${isTerminalCol ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between px-1">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${meta.color}`}>
          {meta.label}
        </span>
        <span className="text-xs text-muted-foreground">{stageTotals?.count ?? records.length}</span>
      </div>
      <div className="px-1 text-xs text-muted-foreground">
        {formatCurrency(stageTotals?.totalAmount ?? records.reduce((s, r) => s + r.amount, 0))}
      </div>
      <div className="space-y-2">
        {records.map((record) => (
          <FundingKanbanCard key={record.id} record={record} onClick={() => onCardClick(record)} />
        ))}
      </div>
    </div>
  );
}
