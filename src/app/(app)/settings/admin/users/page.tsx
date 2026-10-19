import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UsersClient } from "./users-client";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "users:manage")) redirect("/dashboard");

  try {
    const rawUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        totpEnabledAt: true,
      },
      orderBy: { name: "asc" },
    });

    const users = rawUsers.map(({ totpEnabledAt, ...u }) => ({
      ...u,
      mfaEnabled: totpEnabledAt !== null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }));

    return <UsersClient initialUsers={users} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const migrationPending =
      message.includes("Unknown field") || message.includes("The column") || message.includes("P2022");

    if (migrationPending) {
      return (
        <>
          <Topbar
            title="User Management"
            subtitle="Manage team members and access levels"
            breadcrumbs={[
              { label: "Settings", href: "/settings" },
              { label: "Admin", href: "/settings/admin/users" },
            ]}
          />
          <main className="flex-1 overflow-auto p-6 space-y-5">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium">Database migration pending</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Run Prisma migrations on this environment and restart the app to enable admin user management.
                </p>
              </CardContent>
            </Card>
          </main>
        </>
      );
    }

    throw error;
  }
}
