import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info" | "neutral" | "blocked";
  size?: "sm" | "md";
}

const variantClasses = {
  default: "bg-primary/10 text-primary ring-input",
  success: "bg-primary/10 text-primary ring-input",
  warning: "bg-warning/10 text-warning ring-input",
  danger: "bg-destructive/10 text-destructive ring-input",
  info: "bg-ledger-tint text-foreground ring-input",
  neutral: "bg-muted text-muted-foreground ring-input",
  blocked: "bg-warning/10 text-warning ring-input",
};

/** A shape beside the word, so status never rests on colour alone. */
const glyphs: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "●", success: "✓", warning: "▲", danger: "✕", info: "◐", neutral: "○", blocked: "■",
};

const sizeClasses = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-0.5 text-xs",
};

export function Badge({ className, variant = "default", size = "md", children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      <span aria-hidden className="text-[0.7em] leading-none">{glyphs[variant]}</span>
      {children}
    </span>
  );
}

export function StatusBadge({ status, size }: { status: string; size?: "sm" | "md" }) {
  const map: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
    BACKLOG:      { label: "Backlog",      variant: "neutral" },
    IN_PROGRESS:  { label: "In Progress",  variant: "info" },
    DONE:         { label: "Done",         variant: "success" },
    BLOCKED:      { label: "Blocked",      variant: "blocked" },
    ON_HOLD:      { label: "On Hold",      variant: "warning" },
    OVERDUE:      { label: "Overdue",      variant: "danger" },
    NOT_STARTED:  { label: "Not Started",  variant: "neutral" },
    COMPLETE:     { label: "Complete",     variant: "success" },
  };
  const cfg = map[status] ?? { label: status, variant: "neutral" };
  return <Badge variant={cfg.variant} size={size}>{cfg.label}</Badge>;
}

export function PriorityBadge({ priority, size }: { priority: string; size?: "sm" | "md" }) {
  const map: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
    HIGH: { label: "High", variant: "danger" },
    MED:  { label: "Med",  variant: "warning" },
    LOW:  { label: "Low",  variant: "neutral" },
  };
  const cfg = map[priority] ?? { label: priority, variant: "neutral" };
  return <Badge variant={cfg.variant} size={size}>{cfg.label}</Badge>;
}

export function TagBadge({ name }: { name: string; color?: string }) {
  const tagColors: Record<string, string> = {
    "#Mori-Infra":   "bg-primary/10 text-primary ring-input",
    "#Veda-Science": "bg-primary/10 text-primary ring-input",
    "#Ops-Sales":    "bg-ledger-tint text-ledger ring-input",
  };
  const cls = tagColors[name] ?? "bg-muted text-muted-foreground ring-input";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", cls)}>
      {name}
    </span>
  );
}
