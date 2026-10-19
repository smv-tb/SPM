"use client";

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortDirection } from "@/hooks/use-sortable-data";

interface SortableThProps {
  label: string;
  sortKey: string;
  activeKey: string | null;
  direction: SortDirection;
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
  className?: string;
}

export function SortableTh({ label, sortKey, activeKey, direction, onSort, align = "left", className }: SortableThProps) {
  const active = activeKey === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap select-none hover:text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 min-h-6 rounded focus-visible:outline-2 focus-visible:outline-ring",
          align === "right" && "flex-row-reverse w-full justify-start",
          align === "center" && "justify-center w-full"
        )}
      >
        {label}
        {active ? (
          direction === "asc" ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-30" />
        )}
      </button>
    </th>
  );
}
