"use client";

import { useState, useEffect, useCallback } from "react";

const DISMISSED_KEY = "smartvie:dismissed-recommendations";

interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
}

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function persistDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore quota errors
  }
}

interface RecommendedActionsProps {
  recommendations: Recommendation[];
}

export function RecommendedActions({ recommendations }: RecommendedActionsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // Read localStorage after mount so the client's first render matches the
  // server's (which has no access to localStorage) and avoids a hydration mismatch.
  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  const handleDone = useCallback(
    (id: string) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(id);
        persistDismissed(next);
        return next;
      });
    },
    [],
  );

  const visible = recommendations.filter((r) => !dismissed.has(r.id));

  if (visible.length === 0) {
    return (
      <div className="bg-surface-container-low rounded-xl overflow-hidden">
        <div className="px-8 py-6 border-b border-border">
          <h4 className="text-lg font-extrabold tracking-tight">Recommended Actions</h4>
        </div>
        <div className="p-8 text-center text-sm text-muted-foreground">
          <svg className="w-10 h-10 mx-auto mb-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          All recommendations addressed. Great work.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-low rounded-xl overflow-hidden">
      <div className="px-8 py-6 border-b border-border">
        <h4 className="text-lg font-extrabold tracking-tight">Recommended Actions</h4>
      </div>
      <div className="divide-y divide-border/40">
        {visible.map((rec) => {
          const priorityDot =
            rec.priority === "high"
              ? "bg-red-500"
              : rec.priority === "medium"
                ? "bg-amber-500"
                : "bg-slate-300";

          return (
            <div key={rec.id} className="px-8 py-5 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${priorityDot}`} />
                  <h5 className="text-sm font-bold">{rec.title}</h5>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {rec.priority}
                  </span>
                </div>
                {rec.description && (
                  <p className="text-xs text-muted-foreground mt-1 ml-4 leading-relaxed">{rec.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDone(rec.id)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Done
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
