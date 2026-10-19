import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { MfaSettings } from "@/components/settings/MfaSettings";
import { prisma } from "@/lib/prisma";
import { isMfaEnabled, recoveryCodesRemaining } from "@/lib/mfa/service";

export default async function SecuritySettingsPage() {
  const session = await auth();
  const user = session?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  if (!user?.email || !user.id) redirect("/login");

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { totpSecretEnc: true, totpEnabledAt: true },
  });
  const enabled = !!row && isMfaEnabled(row);
  const mfa = {
    enabled,
    enabledAt: enabled ? row!.totpEnabledAt!.toISOString() : null,
    recoveryCodesRemaining: enabled ? await recoveryCodesRemaining(prisma, user.id) : 0,
  };

  return (
    <>
      <Topbar
        title="Security"
        subtitle="Your sign-in"
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Security" }]}
      />
      <main className="flex-1 overflow-auto p-6 space-y-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Two-factor sign-in</CardTitle>
          </CardHeader>
          <CardContent>
            <MfaSettings initial={mfa} email={user.email} />
          </CardContent>
        </Card>

        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Changing your password signs you out everywhere, including this browser.
            </p>
            <ChangePasswordForm email={user.email} name={user.name ?? ""} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
