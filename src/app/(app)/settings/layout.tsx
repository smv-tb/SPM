import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { resolveProjectScope } from "@/lib/current-project";
import { SettingsNav, type SettingsNavGroup } from "@/components/settings/SettingsNav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const scope = await resolveProjectScope(session.user.id);
  const canManageUsers = hasPermission(session, "users:manage");

  const groups: SettingsNavGroup[] = [
    {
      label: "Account",
      items: [
        { href: "/settings/profile", label: "Profile" },
        { href: "/settings/security", label: "Security" },
      ],
    },
  ];
  if (scope?.kind === "project") {
    groups.push({
      label: scope.project.name,
      items: [
        { href: "/settings/project", label: "General" },
        { href: "/settings/project/phases", label: "Phases" },
        { href: "/settings/project/tags", label: "Tags" },
        { href: "/settings/project/custom-fields", label: "Custom fields" },
      ],
    });
  }
  const workspace = [
    { href: "/settings/projects", label: "Projects" },
    { href: "/settings/cost-categories", label: "Cost categories" },
    { href: "/settings/organisation", label: "Organisation" },
    { href: "/settings/team", label: "Team" },
  ];
  // Books settings live with the books; listed here so they can be found.
  if (hasPermission(session, "books:view")) workspace.push({ href: "/books/settings", label: "Books settings" });
  groups.push({ label: "Workspace", items: workspace });
  if (canManageUsers) {
    groups.push({ label: "Admin", items: [{ href: "/settings/admin/users", label: "Users" }] });
  }

  return (
    <div className="flex flex-col md:flex-row flex-1 min-w-0">
      <SettingsNav groups={groups} />
      <div className="flex flex-col flex-1 min-w-0">{children}</div>
    </div>
  );
}
