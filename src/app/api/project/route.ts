import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { projectUpdateSchema } from "@/schemas/project";
import { isPrivateUrl } from "@/lib/ssrf";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";
import { createProject } from "@/lib/projects";
import { PROJECT_ARCHIVED_MESSAGE } from "@/lib/project-scope";
import { z } from "zod";
import { requireProjectAccess } from "@/lib/project-access";

const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(255),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  logoUrl: z.string().url("Logo URL must be a valid URL").max(500).nullable().optional(),
  /** Copy phases, tags and custom fields from this project. */
  templateProjectId: z.string().min(1).max(100).nullable().optional(),
});

export const POST = withErrorHandler(async (req: Request) => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const validation = projectCreateSchema.safeParse(await req.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }
  const { templateProjectId, ...data } = validation.data;

  // SSRF validation: reject private/internal IPs for logoUrl
  if (data.logoUrl && isPrivateUrl(data.logoUrl)) {
    return NextResponse.json(
      { error: "Invalid logoUrl: private or internal URLs are not allowed" },
      { status: 400 }
    );
  }
  if (templateProjectId && !(await prisma.project.findUnique({ where: { id: templateProjectId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Template project not found" }, { status: 404 });
  }

  // A template is read in full, so it has to be a project the caller may open.
  if (templateProjectId) await requireProjectAccess(session, templateProjectId);

  const userId = session.user.id;
  const { project, copied } = await prisma.$transaction(async (tx) => {
    const result = await createProject(tx, data, userId, templateProjectId);
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "project.create",
      entityType: "Project",
      entityId: result.project.id,
      after: { ...result.project, templateProjectId: templateProjectId ?? null, copied: result.copied },
      ipAddress: requestIp(req),
    });
    return result;
  });
  return NextResponse.json({ ...project, copied }, { status: 201 });
});

export const PATCH = withErrorHandler(async (req: Request) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = projectUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const { id, name, description, startDate, endDate, logoUrl, historicalSpend } = validation.data;
  await requireProjectAccess(session, id, "project:edit");

  // SSRF validation: reject private/internal IPs for logoUrl
  if (logoUrl && isPrivateUrl(logoUrl)) {
    return NextResponse.json(
      { error: "Invalid logoUrl: private or internal URLs are not allowed" },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id } });
    if (!before) return { status: 404 as const };
    // The projects row has no archive trigger (archiving *is* an update to it), so check here.
    if (before.archivedAt) return { status: 409 as const };
    const after = await tx.project.update({
      where: { id },
      data: { name, description, startDate, endDate, logoUrl, historicalSpend },
    });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "project.update",
      entityType: "Project",
      entityId: id,
      before,
      after,
      ipAddress: requestIp(req),
    });
    return { status: 200 as const, project: after };
  });

  if (result.status === 404) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (result.status === 409) {
    return NextResponse.json({ error: PROJECT_ARCHIVED_MESSAGE, code: "project_archived" }, { status: 409 });
  }
  return NextResponse.json(result.project);
});
