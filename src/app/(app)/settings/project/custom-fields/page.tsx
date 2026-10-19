export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { hasPermission } from "@/lib/permissions";
import { requireCurrentProject } from "@/lib/current-project";
import { CustomFieldsManager } from "@/components/settings/CustomFieldsManager";

export default async function ProjectCustomFieldsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { projectId, project } = await requireCurrentProject(session.user.id);
  const rows = await prisma.customFieldDefinition.findMany({
    where: { projectId },
    select: {
      id: true, module: true, name: true, fieldType: true, required: true, defaultValue: true, orderIndex: true, options: true,
      _count: { select: { values: true } },
    },
    orderBy: [{ module: "asc" }, { orderIndex: "asc" }, { name: "asc" }],
  });
  const fields = rows.map(({ _count, options, ...f }) => ({
    ...f,
    choices: Array.isArray((options as { choices?: unknown } | null)?.choices)
      ? ((options as { choices: unknown[] }).choices.filter((c) => typeof c === "string") as string[])
      : [],
    values: _count.values,
  }));

  return (
    <>
      <Topbar title="Custom fields" subtitle={project.name} breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Custom fields" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-4xl">
        <CustomFieldsManager projectId={projectId} fields={fields} canEdit={hasPermission(session, "project:structure")} />
      </main>
    </>
  );
}
