export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { activeProjects } from "@/lib/current-project";
import { ProfileSettings } from "@/components/settings/ProfileSettings";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [user, projects] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, email: true, role: true, defaultProjectId: true, totpEnabledAt: true },
    }),
    activeProjects(session.user.id),
  ]);

  return (
    <>
      <Topbar title="Profile" subtitle="Your details and preferences" breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Profile" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-3xl">
        <ProfileSettings
          name={user.name}
          email={user.email}
          role={user.role}
          twoFactor={!!user.totpEnabledAt}
          defaultProjectId={projects.some((p) => p.id === user.defaultProjectId) ? user.defaultProjectId : null}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </main>
    </>
  );
}
