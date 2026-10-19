import { redirect } from "next/navigation";
import { authIncludingPendingSetup } from "@/lib/auth";
import { pendingSetupPath } from "@/lib/pending-setup";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { SignOutButton } from "@/components/settings/SignOutButton";

/**
 * Where a user is sent while they hold a password an administrator chose.
 * Outside both route groups on purpose: `(app)` bounces pending users here and
 * `(auth)` would bounce them back, so this page has to sit in neither.
 */
export default async function ChangePasswordPage() {
  const session = await authIncludingPendingSetup();
  const user = session?.user as
    | { name?: string | null; email?: string | null; mustChangePassword?: boolean; mfaSetupRequired?: boolean }
    | undefined;
  if (!user?.email) redirect("/login");
  // Not owed: go wherever the user does need to be (two-factor setup), or the normal settings page.
  if (!user.mustChangePassword) redirect(pendingSetupPath(user) ?? "/settings/security");

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(222,47%,11%)] p-4">
      <div className="w-full max-w-sm bg-card rounded-[28px] border border-border p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Choose your own password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            An administrator set the password you just signed in with. Replace it with one only you know
            before continuing.
          </p>
        </div>
        <ChangePasswordForm email={user.email} name={user.name ?? ""} />
        <SignOutButton />
      </div>
    </div>
  );
}
