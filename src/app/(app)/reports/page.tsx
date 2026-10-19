export const dynamic = "force-dynamic";
import { Topbar } from "@/components/layout/topbar";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { PIPELINE_STAGES, isTrackedInPipeline, FUNDING_STAGE_META, computeWeightedForecast, computeSecuredCash } from "@/lib/funding";
import { ReportsCharts } from "./reports-charts";
import { requireCurrentProject } from "@/lib/current-project";

async function getReportData(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      taskAssignments: {
        where: { role: "OWNER" },
        include: { user: { select: { id: true, name: true } } },
      },
      milestone: { select: { code: true, title: true } },
      costCategory: { select: { name: true } },
    },
  });

  const fundingRecords = await prisma.fundingRecord.findMany({ where: { projectId } });

  // Group by owner
  const ownerMap: Record<string, { name: string; estBudget: number; actualSpend: number; extCosts: number; taskCount: number }> = {};
  let totalEst = 0;

  for (const task of tasks) {
    const ownerName = task.taskAssignments[0]?.user.name ?? "Unassigned";
    const ownerId = task.taskAssignments[0]?.user.id ?? "unassigned";
    const est = Number(task.estBudget ?? 0);
    const actual = Number(task.actualSpend ?? 0);
    const ext = Number(task.extCosts ?? 0);

    if (!ownerMap[ownerId]) ownerMap[ownerId] = { name: ownerName, estBudget: 0, actualSpend: 0, extCosts: 0, taskCount: 0 };
    ownerMap[ownerId].estBudget += est;
    ownerMap[ownerId].actualSpend += actual;
    ownerMap[ownerId].extCosts += ext;
    ownerMap[ownerId].taskCount += 1;
    totalEst += est;
  }

  const rows = Object.values(ownerMap).sort((a, b) => b.estBudget - a.estBudget);

  // Category breakdown
  const catMap: Record<string, number> = {};
  for (const task of tasks) {
    const cat = task.costCategory?.name ?? "Uncategorised";
    catMap[cat] = (catMap[cat] ?? 0) + Number(task.estBudget ?? 0);
  }

  // Funding source breakdown
  const fundingSourceMap: Record<string, number> = {};
  for (const record of fundingRecords) {
    const source = record.source || "Unknown";
    fundingSourceMap[source] = (fundingSourceMap[source] ?? 0) + Number(record.amount);
  }

  // Pipeline by stage (funnel) + secured vs weighted forecast
  const pipelineRecords = fundingRecords.filter((r) => r.section === "PIPELINE" && isTrackedInPipeline(r.stage));
  const pipelineByStage = PIPELINE_STAGES.map((stage) => {
    const recs = pipelineRecords.filter((r) => r.stage === stage);
    return {
      stage,
      label: FUNDING_STAGE_META[stage].label,
      color: FUNDING_STAGE_META[stage].color,
      count: recs.length,
      totalAmount: recs.reduce((s, r) => s + Number(r.amount), 0),
    };
  });
  const securedTotal = computeSecuredCash(fundingRecords);
  const weightedForecastTotal = computeWeightedForecast(pipelineRecords);

  return { rows, totalEst, catMap, fundingSourceMap, pipelineByStage, securedTotal, weightedForecastTotal };
}

export default async function ReportsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { projectId } = await requireCurrentProject(session.user!.id!);
  const { rows, totalEst, catMap, fundingSourceMap, pipelineByStage, securedTotal, weightedForecastTotal } = await getReportData(projectId);

  return (
    <>
      <Topbar title="Reports" subtitle="Cost pivot · Budget by owner & category" />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        {/* Cost pivot by owner */}
        <Card>
          <CardHeader><CardTitle>Cost Pivot — By Owner</CardTitle></CardHeader>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Owner</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Tasks</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Est. Budget</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Actual Spend</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Ext. Costs</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Remaining</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                      No data yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const pct = totalEst > 0 ? ((r.estBudget / totalEst) * 100).toFixed(1) : "0.0";
                    const remaining = r.estBudget - r.actualSpend;
                    return (
                      <tr key={r.name} className="hover:bg-muted/20">
                        <td className="px-5 py-3 font-medium">{r.name}</td>
                        <td className="px-3 py-3 text-right text-muted-foreground">{r.taskCount}</td>
                        <td className="px-3 py-3 text-right font-medium">{formatCurrency(r.estBudget)}</td>
                        <td className="px-3 py-3 text-right">{formatCurrency(r.actualSpend)}</td>
                        <td className="px-3 py-3 text-right">{r.extCosts > 0 ? formatCurrency(r.extCosts) : "—"}</td>
                        <td className={`px-3 py-3 text-right font-medium ${remaining < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {formatCurrency(remaining)}
                        </td>
                        <td className="px-5 py-3 text-right text-muted-foreground">{pct}%</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/20">
                    <td className="px-5 py-2.5 font-semibold">Total</td>
                    <td className="px-3 py-2.5 text-right font-semibold">
                      {rows.reduce((s, r) => s + r.taskCount, 0)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold">{formatCurrency(totalEst)}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>

        {/* Cost by category */}
        <Card>
          <CardHeader><CardTitle>Cost Breakdown — By Category</CardTitle></CardHeader>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Category</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Est. Budget</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(catMap)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, budget]) => (
                    <tr key={cat} className="hover:bg-muted/20">
                      <td className="px-5 py-3">{cat}</td>
                      <td className="px-5 py-3 text-right font-medium">{formatCurrency(budget)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Cost by funding source */}
        <Card>
          <CardHeader><CardTitle>Cost by Funding Source</CardTitle></CardHeader>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Source</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Total Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(fundingSourceMap)
                  .sort((a, b) => b[1] - a[1])
                  .map(([source, amount]) => (
                    <tr key={source} className="hover:bg-muted/20">
                      <td className="px-5 py-3">{source}</td>
                      <td className="px-5 py-3 text-right font-medium">{formatCurrency(amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <ReportsCharts
          pipelineByStage={pipelineByStage}
          securedTotal={securedTotal}
          weightedForecastTotal={weightedForecastTotal}
        />
      </main>
    </>
  );
}
