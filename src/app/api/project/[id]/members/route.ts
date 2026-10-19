export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler, apiError } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { actorFromSession, requestIp } from "@/lib/audit";
import { stepUpGuard } from "@/lib/mfa/step-up";
import { booksError } from "@/lib/books-api";
import { listMembers, removeMember, setMember } from "@/lib/project-members";
import { MEMBER_ROLES } from "@/lib/project-membership";

type RouteContext = { params: Promise<{ id: string }> };

const putSchema = z.object({ userId: z.string().min(1).max(100), role: z.enum(MEMBER_ROLES) });

/** Who can open this project. Admins reach every project and are not listed. */
export const GET = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  if (!hasPermission(session, "project:members")) return apiError("Forbidden", 403);

  const { id } = await params;
  if (!(await prisma.project.findUnique({ where: { id }, select: { id: true } }))) return apiError("Project not found", 404);
  return NextResponse.json(await listMembers(prisma, id));
});

/** Adds a member or changes their role. Handing out access, so it needs a second-factor check. */
export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  if (!hasPermission(session, "project:members")) return apiError("Forbidden", 403);
  const refusal = await stepUpGuard(session);
  if (refusal) return refusal;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request data", details: parsed.error.flatten() }, { status: 400 });

  const { id } = await params;
  const actor = actorFromSession(session);
  try {
    const outcome = await prisma.$transaction((tx) =>
      setMember(tx, { projectId: id, ...parsed.data, actor, addedById: session.user!.id!, ipAddress: requestIp(req) })
    );
    return NextResponse.json({ outcome });
  } catch (error) {
    return booksError(error);
  }
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  if (!hasPermission(session, "project:members")) return apiError("Forbidden", 403);

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return apiError("userId is required", 400);

  const { id } = await params;
  const removed = await prisma.$transaction((tx) =>
    removeMember(tx, { projectId: id, userId, actor: actorFromSession(session), ipAddress: requestIp(req) })
  );
  return removed ? NextResponse.json({ ok: true }) : apiError("That person is not a member", 404);
});
