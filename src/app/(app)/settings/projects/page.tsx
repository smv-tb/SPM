export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { hasPermission } from "@/lib/permissions";
import { resolveProjectScope } from "@/lib/current-project";
import { projectAccessWhere } from "@/lib/project-access";
import { ProjectsManager } from "@/components/settings/ProjectsManager";

export default async function ProjectsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const canManageMembers = hasPermission(session, "project:members");
  const [rows, me, scope, candidates] = await Promise.all([
    prisma.project.findMany({
      where: await projectAccessWhere(session.user.id),
      select: {
        id: true, name: true, description: true, startDate: true, endDate: true, archivedAt: true,
        _count: { select: { milestones: true, tasks: true, fundingRecords: true } },
      },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { defaultProjectId: true } }),
    resolveProjectScope(session.user.id),
    canManageMembers
      ? prisma.user.findMany({
          where: { isActive: true, role: { not: "ADMIN" } },
          select: { id: true, name: true, email: true, role: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const projects = rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    startDate: p.startDate?.toISOString() ?? null,
    endDate: p.endDate?.toISOString() ?? null,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    counts: p._count,
  }));

  return (
    <>
      <Topbar
        title="Projects"
        subtitle="Create, open, archive and restore projects"
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Projects", href: "/settings/projects" }]}
      />
      <main className="flex-1 overflow-auto p-6">
        <ProjectsManager
          projects={projects}
          currentProjectId={scope?.kind === "project" ? scope.projectId : null}
          defaultProjectId={me?.defaultProjectId ?? null}
          canCreate={hasPermission(session, "project:create")}
          canArchive={hasPermission(session, "project:archive")}
          canDelete={hasPermission(session, "project:delete")}
          canManageMembers={canManageMembers}
          memberCandidates={candidates}
        />
      </main>
    </>
  );
}
