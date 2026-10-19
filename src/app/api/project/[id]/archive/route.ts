export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";
import { requireProjectAccess } from "@/lib/project-access";

const bodySchema = z.object({ archived: z.boolean() });

/**
 * Archives or restores a project. Archived, it leaves the switcher and the
 * portfolio totals and becomes read-only (the database refuses writes to its
 * rows); nothing is deleted, so restoring brings everything back as it was.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "project:archive")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await requireProjectAccess(session, id, "project:archive");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say whether to archive or restore" }, { status: 400 });
  const { archived } = parsed.data;
  const userId = session.user.id;

  const project = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id }, select: { id: true, archivedAt: true, archivedBy: true } });
    if (!before) return null;
    if (!!before.archivedAt === archived) return before; // already so: nothing to record
    const after = await tx.project.update({
      where: { id },
      data: archived ? { archivedAt: new Date(), archivedBy: userId } : { archivedAt: null, archivedBy: null },
      select: { id: true, archivedAt: true, archivedBy: true },
    });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: archived ? "project.archive" : "project.restore",
      entityType: "Project",
      entityId: id,
      before,
      after,
      ipAddress: requestIp(req),
    });
    return after;
  });

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(project);
});
