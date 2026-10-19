export const dynamic = "force-dynamic";
import { Metadata } from "next";
import { Topbar } from "@/components/layout/topbar";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatDate, daysUntil } from "@/lib/utils";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { RecommendedActions } from "@/components/dashboard/RecommendedActions";
import { getDashboardData } from "@/lib/dashboard";
import { buildRecommendations } from "@/lib/recommendations";
import { ORGANIZATION_NAME, DEFAULT_LOCALE, DEFAULT_DATE_FORMAT } from "@/lib/constants";
import Link from "next/link";
import { resolveProjectScope } from "@/lib/current-project";

export const metadata: Metadata = {
  title: "Project Dashboard",
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const scope = await resolveProjectScope(session.user!.id!, { allowAll: true });
  if (!scope) redirect("/settings/projects");
  const { kpis, milestones } = await getDashboardData(scope);
  const scopeLabel = scope.kind === "all" ? `All projects (${scope.projects.length})` : scope.project.name;
  const completionPct = kpis.totalTasks > 0 ? Math.round((kpis.done / kpis.totalTasks) * 100) : 0;
  const spendPct = kpis.totalEstBudget > 0 ? Math.round((kpis.totalActualSpend / kpis.totalEstBudget) * 100) : 0;

  const statusData = [
    { name: "DONE", value: kpis.done },
    { name: "IN_PROGRESS", value: kpis.inProgress },
    { name: "BLOCKED", value: kpis.blocked },
    { name: "OVERDUE", value: kpis.overdue },
    { name: "BACKLOG", value: kpis.totalTasks - kpis.done - kpis.inProgress - kpis.blocked - kpis.overdue },
  ].filter(d => d.value > 0);

  const milestoneChartData = milestones.map((m: { code: string; dueDate: Date | null; estBudget: number; actualSpend: number; percentComplete: number }) => ({
    code: m.code, dueDate: m.dueDate ? new Date(m.dueDate).toLocaleDateString(DEFAULT_LOCALE, DEFAULT_DATE_FORMAT) : '', estBudget: m.estBudget, actualSpend: m.actualSpend, percentComplete: m.percentComplete,
  }));

  const recommendations = buildRecommendations(milestones, kpis);

  return (
    <>
      <Topbar title="Project Dashboard" subtitle={`${ORGANIZATION_NAME} · ${scopeLabel}`} breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }]} />

      <main className="flex-1 overflow-auto px-8 py-8 space-y-8 max-w-[1440px]">
        {/* KPI Header — 3 hero cards */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Overall Progress */}
          <div className="bg-surface-container-low rounded-xl p-8">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-[0.15em]">Overall Progress</span>
            <div className="flex items-end justify-between mt-2">
              <h2 className="text-4xl font-extrabold tracking-tighter">{completionPct}%</h2>
              <span className="text-xs text-muted-foreground">{kpis.done}/{kpis.totalTasks} tasks</span>
            </div>
            <div className="mt-6">
              <Progress value={completionPct} />
            </div>
          </div>

          {/* Budget */}
          <div className="bg-surface-container-low rounded-xl p-8">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-[0.15em]">Project Budget</span>
            <div className="flex flex-col mt-2">
              <h2 className="text-4xl font-extrabold tracking-tighter">{formatCurrency(kpis.totalEstBudget)}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Spent: <span className="text-foreground font-semibold">{formatCurrency(kpis.totalActualSpend)}</span>
              </p>
            </div>
            <div className="mt-6">
              <Progress value={spendPct} />
              <div className="flex justify-between mt-2">
                <span className="text-xs text-muted-foreground">Utilisation</span>
                <span className="text-xs font-bold text-primary">{spendPct}%</span>
              </div>
            </div>
          </div>

          {/* Verified Funding */}
          <div className="bg-surface-container-low rounded-xl p-8 flex items-start justify-between">
            <div>
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-[0.15em]">Verified Funding</span>
              <h2 className="text-4xl font-extrabold tracking-tighter mt-2">{formatCurrency(kpis.totalFunding)}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Runway: <span className="text-foreground font-semibold">{kpis.runwayMonths != null ? `${kpis.runwayMonths.toFixed(1)} mo` : "—"}</span>
                {kpis.nextFundingDeadline && (
                  <> · Next deadline: <span className="text-foreground font-semibold">{formatDate(kpis.nextFundingDeadline)}</span></>
                )}
              </p>
              <Link href="/funding" className="text-xs font-semibold text-primary hover:underline mt-4 inline-block">
                View Ledger
              </Link>
            </div>
            <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
              <svg className="w-7 h-7 text-emerald-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
          </div>
        </section>

        {/* Status counters — compact row */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: "Total Tasks", value: kpis.totalTasks, dot: "bg-primary" },
            { label: "In Progress", value: kpis.inProgress, dot: "bg-sky-500" },
            { label: "Done", value: kpis.done, dot: "bg-emerald-500" },
            { label: "Blocked", value: kpis.blocked, dot: "bg-orange-500" },
            { label: "Overdue", value: kpis.overdue, dot: "bg-red-500" },
          ].map(({ label, value, dot }) => (
            <div key={label} className="flex items-center gap-3 rounded-xl bg-surface-container-low px-5 py-4">
              <div className={`w-2.5 h-2.5 rounded-full ${dot} shrink-0`} />
              <div>
                <p className="text-xl font-extrabold text-foreground leading-none tracking-tight">{value}</p>
                <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Charts */}
        <DashboardCharts statusData={statusData} milestoneData={milestoneChartData} />

        {/* Milestone Progress Table */}
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <div className="px-8 py-6 border-b border-border flex items-center justify-between">
            <h4 className="text-lg font-extrabold tracking-tight">Milestone Progress</h4>
            <Link href="/milestones" className="text-primary text-sm font-bold flex items-center gap-1 hover:underline">
              View all
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs font-bold text-muted-foreground uppercase tracking-[0.15em] bg-surface-container-low/50">
                  <th className="px-8 py-4">Milestone</th>
                  <th className="px-4 py-4">Phase</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4">Priority</th>
                  <th className="px-4 py-4 w-48">Progress</th>
                  <th className="px-4 py-4 text-right">Budget</th>
                  <th className="px-4 py-4">Due</th>
                  <th className="px-8 py-4 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {milestones.map((m: { id: string; code: string; title: string; dueDate: Date | null; status: string; phase: string | null; priority: string; taskCount: number; doneTasks: number; percentComplete: number; estBudget: number; actualSpend: number }) => {
                  const isComplete = m.status === "COMPLETE";
                  const days = isComplete ? null : daysUntil(m.dueDate);
                  return (
                    <tr key={m.id} className="hover:bg-surface-container-low/30 transition-colors">
                      <td className="px-8 py-5">
                        <Link href={`/milestones/${m.id}`} className="group">
                          <div className="font-bold text-sm group-hover:text-primary transition-colors">{m.code}: {m.title}</div>
                        </Link>
                      </td>
                      <td className="px-4 py-5 text-sm font-medium text-muted-foreground italic">{m.phase ?? "—"}</td>
                      <td className="px-4 py-5"><StatusBadge status={m.status} size="sm" /></td>
                      <td className="px-4 py-5">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${m.priority === "HIGH" ? "bg-red-500" : m.priority === "MED" ? "bg-amber-500" : "bg-slate-300"}`} />
                          <span className="text-xs font-semibold">{m.priority === "HIGH" ? "High" : m.priority === "MED" ? "Medium" : "Low"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <div className="flex items-center gap-3">
                          <Progress value={m.percentComplete} className="flex-1" />
                          <span className="text-xs font-bold text-muted-foreground">{m.percentComplete}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-5 text-sm font-bold text-right">{formatCurrency(m.estBudget)}</td>
                      <td className="px-4 py-5 text-sm text-muted-foreground">{formatDate(m.dueDate)}</td>
                      <td className={`px-8 py-5 text-sm font-bold text-right ${isComplete ? "text-emerald-600" : days != null && days < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                        {isComplete ? "Complete" : days != null ? (days < 0 ? `${Math.abs(days)}d over` : `${days}d`) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recommended Actions */}
        <RecommendedActions recommendations={recommendations} />
      </main>
    </>
  );
}
