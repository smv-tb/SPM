export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TasksClient } from "./tasks-client";
import { requireCurrentProject } from "@/lib/current-project";

async function getData(projectId: string) {
  if (!prisma) {
    throw new Error("Prisma client is not initialized. Check setup in src/lib/prisma.ts");
  }

  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    select: { id: true, code: true, title: true },
    orderBy: { orderIndex: "asc" },
  });

  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      milestone: { select: { id: true, code: true, title: true } },
      taskAssignments: { include: { user: { select: { id: true, name: true } } } },
      taskTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      resource: { select: { id: true, name: true } },
    },
    orderBy: [{ milestone: { orderIndex: "asc" } }, { orderIndex: "asc" }],
  });

  const tags = await prisma.tag.findMany({ where: { projectId }, orderBy: { name: "asc" } });

  const resources = await prisma.resource.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const costCategories = await prisma.costCategory.findMany({
    orderBy: { name: "asc" },
  });

  // Serialize dates and decimals
  const serialized = tasks.map(t => ({
    ...t,
    startDate: t.startDate.toISOString(),
    dueDate: t.dueDate.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    estBudget: t.estBudget ? Number(t.estBudget) : null,
    actualSpend: t.actualSpend ? Number(t.actualSpend) : null,
    extCosts: t.extCosts ? Number(t.extCosts) : null,
  }));

  return { tasks: serialized, milestones, tags, resources, costCategories };
}

export default async function TasksPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { projectId, project } = await requireCurrentProject(session.user!.id!);

  const { tasks, milestones, tags, resources, costCategories } = await getData(projectId);

  return <TasksClient initialTasks={tasks} milestones={milestones} tags={tags} resources={resources} costCategories={costCategories} projectId={projectId} projectName={project.name} />;
}
