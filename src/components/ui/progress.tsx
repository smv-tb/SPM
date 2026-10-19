import { cn } from "@/lib/utils";

interface ProgressProps {
  value: number;
  className?: string;
  showLabel?: boolean;
}

export function Progress({ value, className, showLabel }: ProgressProps) {
  const pct = Math.round(Math.min(100, Math.max(0, value)));

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct === 100
              ? "bg-emerald-500"
              : pct > 0
                ? "bg-primary"
                : "bg-transparent"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-bold text-muted-foreground w-8 text-right">{pct}%</span>
      )}
    </div>
  );
}
