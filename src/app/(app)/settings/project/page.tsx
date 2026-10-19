export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { hasPermission } from "@/lib/permissions";
import { requireCurrentProject } from "@/lib/current-project";
import { ProjectGeneral } from "@/components/settings/project/ProjectGeneral";

export default async function ProjectGeneralPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { projectId } = await requireCurrentProject(session.user.id);
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, description: true, startDate: true, endDate: true, logoUrl: true, historicalSpend: true },
  });
  const { historicalSpend, ...info } = project;

  return (
    <>
      <Topbar title="General" subtitle={project.name} breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Project" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-3xl">
        <ProjectGeneral project={info} historicalSpend={Number(historicalSpend)} canEdit={hasPermission(session, "project:edit")} />
      </main>
    </>
  );
}
