export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MilestonesClient } from "./milestones-client";
import { requireCurrentProject } from "@/lib/current-project";

async function getData(projectId: string) {
  const milestones = await prisma.milestone.findMany({
    where: { projectId, parentId: null },
    include: {
      phase: { select: { id: true, name: true, color: true } },
      children: {
        include: { tasks: { select: { percentDone: true, status: true } } },
        orderBy: { orderIndex: "asc" },
      },
      tasks: { select: { percentDone: true, status: true } },
    },
    orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
  });

  const allMilestones = await prisma.milestone.findMany({
    where: { projectId },
    select: { id: true, code: true, title: true },
    orderBy: { orderIndex: "asc" },
  });

  const phases = await prisma.phase.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { orderIndex: "asc" },
  });

  const serialized = milestones.map(m => ({
    ...m,
    startDate: m.startDate.toISOString(),
    dueDate: m.dueDate.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    estBudget: m.estBudget ? Number(m.estBudget) : null,
    actualSpend: m.actualSpend ? Number(m.actualSpend) : null,
    children: m.children.map(c => ({
      ...c,
      startDate: c.startDate.toISOString(),
      dueDate: c.dueDate.toISOString(),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      estBudget: c.estBudget ? Number(c.estBudget) : null,
      actualSpend: c.actualSpend ? Number(c.actualSpend) : null,
    })),
  }));

  return { milestones: serialized, allMilestones, phases, projectId };
}

export default async function MilestonesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { projectId } = await requireCurrentProject(session.user!.id!);

  const data = await getData(projectId);
  return <MilestonesClient {...data} />;
}
