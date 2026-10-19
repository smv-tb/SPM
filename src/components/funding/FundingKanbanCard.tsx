"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { formatCurrency } from "@/lib/utils";
import { FUNDING_STAGE_META, isOverdue, type FundingStage } from "@/lib/funding";

export interface PipelineRecord {
  id: string;
  fundId: string;
  fundName: string;
  source: string;
  amount: number;
  stage: FundingStage | null;
  probability: number | null;
  deadline: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
}

interface Props {
  record: PipelineRecord;
  onClick: () => void;
  overlay?: boolean;
}

export function FundingKanbanCard({ record, onClick, overlay }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: record.id,
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const overdue = isOverdue(record.deadline);
  const probability =
    record.probability ?? (record.stage ? FUNDING_STAGE_META[record.stage].defaultProbability : 0);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`rounded-lg border border-border bg-card p-3 text-xs cursor-pointer touch-none select-none ${
        isDragging ? "opacity-30" : ""
      } ${overlay ? "shadow-[var(--shadow-elevated)] rotate-1" : ""}`}
    >
      <p className="font-semibold text-sm truncate">{record.fundName}</p>
      <p className="text-muted-foreground truncate">{record.source}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="font-bold">{formatCurrency(record.amount)}</span>
        <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 font-semibold">
          {probability}%
        </span>
      </div>
      {record.deadline && (
        <p className={`mt-1.5 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
          Deadline: {new Date(record.deadline).toLocaleDateString()}
        </p>
      )}
      {record.nextAction && (
        <p className="mt-1 text-muted-foreground truncate">
          Next: {record.nextAction}
          {record.nextActionDate ? ` (${new Date(record.nextActionDate).toLocaleDateString()})` : ""}
        </p>
      )}
    </div>
  );
}
