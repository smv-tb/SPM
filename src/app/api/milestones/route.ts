export const dynamic = "force-dynamic";
import { requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { projectFilterForRequest } from "@/lib/current-project";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/constants";
import { milestoneCreateSchema } from "@/schemas/milestone";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || String(DEFAULT_PAGE_LIMIT)), MAX_PAGE_LIMIT);

  const milestones = await prisma.milestone.findMany({
    where: await projectFilterForRequest(session.user!.id!, req),
    include: {
      phase: { select: { id: true, name: true, color: true } },
      parent: { select: { id: true, code: true, title: true } },
      children: { select: { id: true, code: true, title: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { orderIndex: "asc" },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
  });

  const hasMore = milestones.length > limit;
  const data = hasMore ? milestones.slice(0, -1) : milestones;
  const nextCursor = hasMore ? data[data.length - 1]?.id : null;

  return NextResponse.json({ data, nextCursor });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = milestoneCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }
  const data = validation.data;
  await requireProjectAccess(session, data.projectId, "work:edit");

  const startDate = data.startDate ? new Date(data.startDate) : new Date();
  const dueDate = data.dueDate ? new Date(data.dueDate) : new Date();

  const milestone = await prisma.milestone.create({
    data: {
      code: data.code,
      title: data.title,
      projectId: data.projectId,
      description: data.description ?? null,
      phaseId: data.phaseId ?? null,
      parentId: data.parentId ?? null,
      startDate,
      dueDate,
      status: data.status,
      priority: data.priority,
      estBudget: data.estBudget ?? null,
    },
    include: {
      phase: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
  });

  // Revalidate cache
  revalidatePath("/tasks");
  revalidatePath("/milestones");
  revalidatePath("/gantt");
  revalidatePath(`/milestones/${milestone.id}`);

  return NextResponse.json(milestone, { status: 201 });
});
