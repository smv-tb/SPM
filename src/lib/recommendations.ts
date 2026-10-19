import { daysUntil, formatCurrency } from "@/lib/utils";

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
}

export interface MilestoneSummary {
  id: string;
  code: string;
  title: string;
  status: string;
  dueDate: Date | string | null;
  percentComplete: number;
  taskCount: number;
  doneTasks: number;
  actualSpend: number;
  estBudget: number;
}

export interface KpiSummary {
  blocked: number;
  overdue: number;
  totalTasks: number;
  done: number;
}

export function buildRecommendations(milestones: MilestoneSummary[], kpis: KpiSummary): Recommendation[] {
  const recommendations: Recommendation[] = milestones.flatMap((m) => {
    const recs: Recommendation[] = [];
    const isComplete = m.status === "COMPLETE";
    const days = daysUntil(m.dueDate);

    if (!isComplete && m.percentComplete < 30 && m.taskCount > 0) {
      recs.push({
        id: `lagging-${m.id}`,
        title: `Prioritise ${m.code}`,
        description: `${m.title} is at ${m.percentComplete}% with ${m.taskCount - m.doneTasks} open tasks. Consider a sprint push.`,
        priority: "high",
      });
    }

    if (m.actualSpend > m.estBudget && m.estBudget > 0) {
      recs.push({
        id: `overbudget-${m.id}`,
        title: `Review budget for ${m.code}`,
        description: `Spending exceeds estimate by ${formatCurrency(m.actualSpend - m.estBudget)}. Verify costs or request a budget revision.`,
        priority: "high",
      });
    }

    if (!isComplete && days != null && days < 0) {
      recs.push({
        id: `overdue-${m.id}`,
        title: `Resolve overdue milestone ${m.code}`,
        description: `${m.title} is ${Math.abs(days)} days past due at ${m.percentComplete}% completion. Rebaseline or escalate.`,
        priority: "high",
      });
    }

    return recs;
  });

  const completionPct = kpis.totalTasks > 0 ? Math.round((kpis.done / kpis.totalTasks) * 100) : 0;

  if (kpis.blocked > 0) {
    recommendations.push({
      id: "blocked-tasks",
      title: "Unblock stalled tasks",
      description: `${kpis.blocked} task${kpis.blocked > 1 ? "s are" : " is"} currently blocked. Review blockers and reassign if needed.`,
      priority: "high",
    });
  }

  if (kpis.overdue > 0) {
    recommendations.push({
      id: "overdue-tasks",
      title: "Address overdue tasks",
      description: `${kpis.overdue} task${kpis.overdue > 1 ? "s have" : " has"} missed their deadline. Re-schedule or mark as done.`,
      priority: "medium",
    });
  }

  if (completionPct < 25 && kpis.totalTasks > 0) {
    recommendations.push({
      id: "early-progress",
      title: "Kick-start project execution",
      description: `Only ${completionPct}% of tasks are done so far. Move early-stage tasks out of backlog to build momentum.`,
      priority: "medium",
    });
  }

  return recommendations;
}
