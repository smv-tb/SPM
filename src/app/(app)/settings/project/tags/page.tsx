export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { hasPermission } from "@/lib/permissions";
import { requireCurrentProject } from "@/lib/current-project";
import { TagsManager } from "@/components/settings/TagsManager";

export default async function ProjectTagsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { projectId, project } = await requireCurrentProject(session.user.id);
  const tags = await prisma.tag.findMany({
    where: { projectId },
    select: { id: true, name: true, color: true, _count: { select: { taskTags: true, milestoneTags: true, resourceTags: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <Topbar title="Tags" subtitle={project.name} breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Tags" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-3xl">
        <TagsManager
          projectId={projectId}
          tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color, uses: t._count.taskTags + t._count.milestoneTags + t._count.resourceTags }))}
          canEdit={hasPermission(session, "project:structure")}
        />
      </main>
    </>
  );
}
