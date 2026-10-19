import { Fragment } from "react";
import { redirect } from "next/navigation";
import { authIncludingPendingSetup } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { pendingSetupPath, type PendingFlags } from "@/lib/pending-setup";
import { graceDeadline, policyFromEnv } from "@/lib/mfa/policy";
import { isMfaEnabled } from "@/lib/mfa/service";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { StepUpDialog } from "@/components/settings/StepUpDialog";
import { resolveProjectScope } from "@/lib/current-project";
import { FrameUserProvider } from "@/components/layout/user-context";

const ROLE_LABELS: Record<string, string> = { ADMIN: "Administrator", PM: "Project manager", CONTRIBUTOR: "Contributor", VIEWER: "Read-only" };

// The render rules forbid reading the clock inline; this is a request-time layout, so now is right.
const nowMs = () => Date.now();

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await authIncludingPendingSetup();
  if (!session?.user?.id) redirect("/login");
  // Whatever the user still owes (a temporary password, a required second factor) comes first.
  const pending = pendingSetupPath(session.user as PendingFlags);
  if (pending) redirect(pending);

  // Resolved twice on purpose: the dashboard may show every project ("all"),
  // every other screen falls back to a single one. Both are request-cached.
  const [portfolio, single] = await Promise.all([
    resolveProjectScope(session.user.id, { allowAll: true }),
    resolveProjectScope(session.user.id),
  ]);
  const project = single?.kind === "project" ? single.project : null;
  const currentProjectKey = portfolio ? (portfolio.kind === "all" ? "all" : portfolio.projectId) : "none";

  // Not required yet but will be: count down to it until they have set it up.
  const role = (session.user as { role?: string }).role;
  const deadline = graceDeadline(role, nowMs(), policyFromEnv());
  let showMfaNotice = false;
  if (deadline !== null) {
    const row = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { totpSecretEnc: true, totpEnabledAt: true },
    });
    showMfaNotice = !!row && !isMfaEnabled(row);
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "default" }, select: { legalName: true } });
  const frameUser = {
    name: session.user.name || session.user.email || "Account",
    roleLabel: ROLE_LABELS[role ?? ""] ?? "",
    orgName: company?.legalName || "Smartvie",
  };

  return (
    <FrameUserProvider value={frameUser}>
    <div className="flex min-h-screen bg-surface">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <Sidebar
        logoUrl={project?.logoUrl || null}
        userRole={(session.user as { role?: string })?.role ?? null}
        projects={(single?.projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
        currentProjectId={portfolio ? currentProjectKey : null}
        fallbackProjectId={project?.id ?? null}
      />
      <div id="main-content" tabIndex={-1} className="flex flex-col flex-1 min-w-0 focus:outline-none">
        {showMfaNotice && deadline !== null && (
          <div role="status" className="bg-warning/10 border-b border-warning text-warning text-sm px-6 py-2">
            Two-factor sign-in becomes required on{" "}
            <strong>
              {new Date(deadline).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
            </strong>
            .{" "}
            <Link href="/settings/security" className="underline font-medium">
              Set it up now
            </Link>
          </div>
        )}
        {/* Keyed on the project so client screens that copy their props into
            state (Tasks, Gantt…) start afresh when the user switches. */}
        <Fragment key={currentProjectKey}>{children}</Fragment>
      </div>
      <StepUpDialog />
      <ConfirmDialogHost />
    </div>
    </FrameUserProvider>
  );
}
