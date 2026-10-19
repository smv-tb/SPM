export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ResourcesClient } from "./resources-client";
import { requireCurrentProject } from "@/lib/current-project";

async function getData(projectId: string) {
  const resources = await prisma.resource.findMany({
    where: { projectId },
    include: {
      resourceMilestones: { include: { milestone: { select: { id: true, code: true } } } },
      // Direct tasks via resourceId
      tasks: {
        select: { taskTags: { select: { tag: { select: { name: true } } } } },
      },
      // Tasks via user assignment (primary link)
      user: {
        select: {
          taskAssignments: {
            select: { task: { select: { taskTags: { select: { tag: { select: { name: true } } } } } } },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    select: { id: true, code: true, title: true },
    orderBy: { orderIndex: "asc" },
  });

  const allTags = await prisma.tag.findMany({ where: { projectId }, orderBy: { name: "asc" } });

  const serialized = resources.map(r => {
    // Derive unique tag names from tasks (via direct resourceId + via user assignments)
    const directTags = r.tasks.flatMap(t => t.taskTags.map(tt => tt.tag.name));
    const assignmentTags = r.user?.taskAssignments?.flatMap(
      (a) => a.task.taskTags.map((tt) => tt.tag.name)
    ) ?? [];
    const tagNames = [...new Set([...directTags, ...assignmentTags])];
    return {
      ...r,
      dayRate: r.dayRate ? Number(r.dayRate) : null,
      yearlyCost: r.yearlyCost ? Number(r.yearlyCost) : null,
      derivedTags: tagNames,
    };
  });

  return { resources: serialized, milestones, projectId, tags: allTags };
}

export default async function ResourcesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { projectId } = await requireCurrentProject(session.user!.id!);

  const data = await getData(projectId);
  return <ResourcesClient {...data} />;
}
