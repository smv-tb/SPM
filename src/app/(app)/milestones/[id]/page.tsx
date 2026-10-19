export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canOpenProject } from "@/lib/project-access";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatDate, daysUntil } from "@/lib/utils";
import { DeleteMilestoneButton } from "../DeleteMilestoneButton";

async function getMilestone(id: string) {
  return prisma.milestone.findUnique({
    where: { id },
    include: {
      phase: true,
      parent: { select: { id: true, code: true, title: true } },
      children: {
        include: {
          tasks: {
            include: { taskAssignments: { include: { user: { select: { name: true } } } } },
          },
        },
        orderBy: { orderIndex: "asc" },
      },
      tasks: {
        include: { taskAssignments: { include: { user: { select: { name: true } } } } },
        orderBy: { orderIndex: "asc" },
      },
      resourceMilestones: { include: { resource: true } },
    },
  });
}

export default async function MilestoneDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const milestone = await getMilestone(id);
  if (!milestone || !(await canOpenProject(session, milestone.projectId))) notFound();

  const allTasks = [...milestone.tasks, ...milestone.children.flatMap((c) => c.tasks)];
  const pct = allTasks.length > 0
    ? Math.round(allTasks.reduce((s, t) => s + t.percentDone, 0) / allTasks.length)
    : 0;
  const isComplete = milestone.status === "COMPLETE";
  const days = isComplete ? null : daysUntil(milestone.dueDate);
  const budgetRem = Number(milestone.estBudget ?? 0) - Number(milestone.actualSpend ?? 0);

  return (
    <>
      <Topbar
        title={milestone.title}
        subtitle={`${milestone.code} · ${milestone.phase?.name ?? "No phase"}`}
        actions={<DeleteMilestoneButton id={milestone.id} title={milestone.title} />}
        breadcrumbs={[
          { label: "Milestones", href: "/milestones" },
          ...(milestone.parent ? [{ label: milestone.parent.code, href: `/milestones/${milestone.parent.id}` }] : []),
          { label: milestone.code },
        ]}
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">

        {/* Overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent><StatusBadge status={milestone.status} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Priority</CardTitle></CardHeader>
            <CardContent><PriorityBadge priority={milestone.priority} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Est. Budget</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xl font-bold">{formatCurrency(Number(milestone.estBudget ?? 0))}</p>
              <p className={`text-sm mt-1 ${budgetRem < 0 ? "text-red-600" : "text-emerald-600"}`}>
                {formatCurrency(budgetRem)} remaining
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Due Date</CardTitle></CardHeader>
            <CardContent>
              <p className="text-base font-medium">{formatDate(milestone.dueDate)}</p>
              {isComplete ? (
                <p className="text-sm mt-1 text-emerald-600">Complete</p>
              ) : days != null && (
                <p className={`text-sm mt-1 ${days < 0 ? "text-red-600" : days < 14 ? "text-amber-600" : "text-muted-foreground"}`}>
                  {days < 0 ? `${Math.abs(days)} days overdue` : `${days} days left`}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Progress */}
        <Card>
          <CardHeader><CardTitle>Overall Progress</CardTitle></CardHeader>
          <CardContent>
            <Progress value={pct} showLabel className="mb-1" />
            <p className="text-xs text-muted-foreground">
              {allTasks.filter((t) => t.status === "DONE").length} of {allTasks.length} tasks complete
            </p>
          </CardContent>
        </Card>

        {/* Direct tasks */}
        {milestone.tasks.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
            <CardContent className="px-0 pb-0">
              <TaskTable tasks={milestone.tasks} />
            </CardContent>
          </Card>
        )}

        {/* Sub-milestones */}
        {milestone.children.map((child) => (
          <Card key={child.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-secondary px-2 py-0.5 rounded text-muted-foreground">
                    {child.code}
                  </span>
                  <CardTitle>{child.title}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={child.status} />
                  <span className="text-sm text-muted-foreground">{formatDate(child.dueDate)}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <TaskTable tasks={child.tasks} />
            </CardContent>
          </Card>
        ))}

        {/* Resources */}
        {milestone.resourceMilestones.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Assigned Resources</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {milestone.resourceMilestones.map((rm) => (
                  <div key={rm.resourceId} className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                      {rm.resource.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">{rm.resource.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{rm.resource.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

function TaskTable({ tasks }: { tasks: Array<{
  id: string; code: string; title: string; status: string; priority: string;
  percentDone: number; estBudget: unknown; actualSpend: unknown; dueDate: Date;
  taskAssignments: Array<{ user: { name: string } }>;
}> }) {
  const totalEst = tasks.reduce((s, t) => s + Number(t.estBudget ?? 0), 0);
  const totalSpend = tasks.reduce((s, t) => s + Number(t.actualSpend ?? 0), 0);
  const totalRem = totalEst - totalSpend;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground">Code</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Task</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Owner</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-28">Progress</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Est. Budget</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Spent</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Remaining</th>
            <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tasks.map((t) => {
            const est = Number(t.estBudget ?? 0);
            const spend = Number(t.actualSpend ?? 0);
            const rem = est - spend;
            return (
              <tr key={t.id} className="hover:bg-muted/20">
                <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{t.code}</td>
                <td className="px-3 py-2.5 font-medium">{t.title}</td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {t.taskAssignments[0]?.user.name ?? "—"}
                </td>
                <td className="px-3 py-2.5"><StatusBadge status={t.status} size="sm" /></td>
                <td className="px-3 py-2.5">
                  <Progress value={t.percentDone} showLabel />
                </td>
                <td className="px-3 py-2.5 text-right text-xs">{formatCurrency(est)}</td>
                <td className="px-3 py-2.5 text-right text-xs font-medium">{formatCurrency(spend)}</td>
                <td className={`px-3 py-2.5 text-right text-xs ${est === 0 && spend === 0 ? "text-muted-foreground" : rem < 0 ? "text-red-600 font-medium" : "text-emerald-600"}`}>
                  {est === 0 && spend === 0 ? "—" : formatCurrency(rem)}
                </td>
                <td className="px-5 py-2.5 text-muted-foreground text-xs">{formatDate(t.dueDate)}</td>
              </tr>
            );
          })}
        </tbody>
        {(totalEst > 0 || totalSpend > 0) && (
          <tfoot>
            <tr className="border-t border-border bg-muted/30">
              <td colSpan={5} className="px-5 py-2 text-xs font-medium text-muted-foreground">{tasks.length} tasks</td>
              <td className="px-3 py-2 text-right text-xs font-bold">{formatCurrency(totalEst)}</td>
              <td className="px-3 py-2 text-right text-xs font-bold">{formatCurrency(totalSpend)}</td>
              <td className={`px-3 py-2 text-right text-xs font-bold ${totalRem < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(totalRem)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
