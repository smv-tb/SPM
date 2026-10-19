import { redirect } from "next/navigation";
import { authIncludingPendingSetup } from "@/lib/auth";
import { pendingSetupPath } from "@/lib/pending-setup";
import { MfaSettings } from "@/components/settings/MfaSettings";
import { SignOutButton } from "@/components/settings/SignOutButton";

/**
 * Where a user is sent when their role requires two-factor sign-in and they
 * have not set it up. Outside both route groups, like /change-password: `(app)`
 * and `(auth)` bounce pending users here, so it can sit in neither.
 */
export default async function SetupTwoFactorPage() {
  const session = await authIncludingPendingSetup();
  const user = session?.user as
    | { email?: string | null; mustChangePassword?: boolean; mfaSetupRequired?: boolean }
    | undefined;
  if (!user?.email) redirect("/login");

  // Not for you (yet): the password comes first, and without a requirement the settings page does the job.
  const path = pendingSetupPath(user);
  if (path !== "/setup-two-factor") redirect(path ?? "/settings/security");

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(222,47%,11%)] p-4">
      <div className="w-full max-w-xl bg-card rounded-[28px] border border-border p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Set up two-factor sign-in</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your role requires a second step at sign-in — a code from an authenticator app on your phone.
            It takes a minute, and you can&rsquo;t continue without it.
          </p>
        </div>
        <MfaSettings
          initial={{ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 }}
          email={user.email}
          forced
        />
        <SignOutButton />
      </div>
    </div>
  );
}
