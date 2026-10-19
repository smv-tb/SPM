export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { canSeeEmail } from "@/lib/redact";
import { hasPermission } from "@/lib/permissions";

const roleColor: Record<string, string> = {
  ADMIN: "bg-violet-100 text-violet-700",
  PM: "bg-primary/10 text-primary",
  CONTRIBUTOR: "bg-emerald-100 text-emerald-700",
  VIEWER: "bg-muted text-muted-foreground",
};

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = hasPermission(session, "users:manage");
  const showEmail = canSeeEmail(session);

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <Topbar title="Team" subtitle={`${users.length} active members`} breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Team" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Team</CardTitle>
              {isAdmin && (
                <Link href="/settings/admin/users">
                  <Button variant="outline" size="sm">
                    <Shield className="w-3.5 h-3.5 mr-1" /> Manage users
                  </Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-2">Name</th>
                  {showEmail && <th className="px-3 py-2">Email</th>}
                  <th className="px-3 py-2">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold shrink-0">
                          {u.name.charAt(0)}
                        </div>
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    {showEmail && <td className="px-3 py-3 text-muted-foreground">{u.email}</td>}
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleColor[u.role] ?? "bg-muted text-muted-foreground"}`}>
                        {u.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
