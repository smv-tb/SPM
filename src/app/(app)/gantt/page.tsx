export const dynamic = "force-dynamic";
import { Topbar } from "@/components/layout/topbar";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { GanttClientPage } from "@/components/gantt/GanttClientPage";
import { requireCurrentProject } from "@/lib/current-project";

async function getGanttData(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      milestone: { select: { id: true, code: true, title: true } },
      taskTags: { include: { tag: true } },
      resource: { select: { id: true, name: true } },
    },
    orderBy: { startDate: "asc" },
  });

  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    select: { id: true, code: true, title: true },
    orderBy: { code: "asc" },
  });

  const resources = await prisma.resource.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const costCategories = await prisma.costCategory.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const tags = await prisma.tag.findMany({
    where: { projectId },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });

  const serializedTasks = JSON.parse(JSON.stringify(tasks, (_key, value) =>
    typeof value === "object" && value !== null && value.constructor?.name === "Decimal"
      ? Number(value)
      : value
  ));

  return { tasks: serializedTasks, milestones, resources, costCategories, tags, projectId };
}

export default async function GanttPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const current = await requireCurrentProject(session.user!.id!);
  const { tasks, milestones, resources, costCategories, tags, projectId } = await getGanttData(current.projectId);

  return (
    <>
      <Topbar title="Gantt Timeline" subtitle="Jan 2026 → Sep 2026 · week view" />
      <main className="flex-1 overflow-auto p-6">
        <GanttClientPage tasks={tasks} milestones={milestones} resources={resources} costCategories={costCategories} tags={tags} projectId={projectId} />
      </main>
    </>
  );
}
