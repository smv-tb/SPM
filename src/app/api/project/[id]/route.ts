export const dynamic = "force-dynamic";

import { requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { stepUpGuard } from "@/lib/mfa/step-up";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";
import { canDelete, deletionBlockers, projectSnapshot } from "@/lib/projects";

/**
 * Deletes a project outright, with everything under it. Admin only, behind a
 * fresh second-factor check, and only for a project that never held money —
 * otherwise the answer is to archive it, which keeps the history.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "project:delete")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await requireProjectAccess(session, id, "project:delete");
  if (!(await prisma.project.findUnique({ where: { id }, select: { id: true } }))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const refusal = await stepUpGuard(session);
  if (refusal) return refusal;

  const result = await prisma.$transaction(async (tx) => {
    const blockers = await deletionBlockers(tx, id);
    if (!canDelete(blockers)) return { deleted: false as const, blockers };
    const snapshot = await projectSnapshot(tx, id);
    if (!snapshot) return { deleted: false as const, blockers: null };
    // An archived project's rows are read-only to the database; the cascade
    // below needs them writable, and this transaction is all-or-nothing.
    if (snapshot.archivedAt) await tx.project.update({ where: { id }, data: { archivedAt: null } });
    await tx.project.delete({ where: { id } });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "project.delete",
      entityType: "Project",
      entityId: id,
      before: snapshot,
      ipAddress: requestIp(req),
    });
    return { deleted: true as const };
  });

  if (result.deleted) return NextResponse.json({ deleted: true });
  if (!result.blockers) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(
    {
      error: "This project has held money or appears in the books, so it can't be deleted. Archive it instead.",
      code: "project_has_money",
      blockers: result.blockers,
    },
    { status: 409 }
  );
});
