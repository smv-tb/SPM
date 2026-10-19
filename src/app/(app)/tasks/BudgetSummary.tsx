import { formatCurrencyAccounting as formatMoney } from "@/lib/utils";

export function BudgetSummary({ est, spent, remaining }: { est: number; spent: number; remaining: number }) {
  return (
  <section aria-label="Budget summary for the tasks shown" className="rounded-xl bg-surface-container-low p-5">
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-4">
      <div>
        <dt className="text-sm text-muted-foreground">Estimated budget</dt>
        <dd className="text-xl font-bold tabular-nums">{formatMoney(est)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Spent</dt>
        <dd className="text-xl font-bold tabular-nums">{formatMoney(spent)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Remaining</dt>
        <dd className={`text-xl font-bold tabular-nums ${remaining < 0 ? "text-destructive" : ""}`}>
          {remaining < 0 && <span aria-hidden>▲ </span>}
          {formatMoney(remaining)}
          {remaining < 0 && <span className="sr-only"> (over budget)</span>}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Budget used</dt>
        <dd className="text-xl font-bold tabular-nums">
          {est > 0 ? `${Math.round((spent / est) * 100)}%` : "No budget set"}
          {est > 0 && spent > est && <span className="text-destructive"> ▲ over</span>}
        </dd>
      </div>
    </dl>
    {est > 0 && (
      <div
        role="progressbar"
        aria-label="Budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round((spent / est) * 100))}
        className="mt-4 h-2 rounded-full bg-muted overflow-hidden"
      >
        <div
          className={`h-full rounded-full ${spent > est ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${Math.min(100, (spent / est) * 100)}%` }}
        />
      </div>
    )}
  </section>
  );
}
