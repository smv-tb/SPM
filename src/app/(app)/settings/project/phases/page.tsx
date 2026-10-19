export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { hasPermission } from "@/lib/permissions";
import { requireCurrentProject } from "@/lib/current-project";
import { PhasesManager } from "@/components/settings/phases/PhasesManager";

export default async function ProjectPhasesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { projectId, project } = await requireCurrentProject(session.user.id);
  const phases = await prisma.phase.findMany({ where: { projectId }, orderBy: { orderIndex: "asc" } });

  return (
    <>
      <Topbar title="Phases" subtitle={project.name} breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Phases" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-3xl">
        <PhasesManager projectId={projectId} phases={phases} canEdit={hasPermission(session, "project:structure")} />
      </main>
    </>
  );
}
