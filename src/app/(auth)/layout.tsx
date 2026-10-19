import { redirect } from "next/navigation";
import { authIncludingPendingSetup } from "@/lib/auth";
import { pendingSetupPath, type PendingFlags } from "@/lib/pending-setup";

/** A signed-in user who still owes a setup step belongs on that page, not the sign-in form. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await authIncludingPendingSetup();
  const pending = pendingSetupPath(session?.user as PendingFlags | undefined);
  if (pending) redirect(pending);
  return children;
}
