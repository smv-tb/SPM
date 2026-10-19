export const dynamic = "force-dynamic";
import { requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { projectFilterForRequest } from "@/lib/current-project";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/constants";
import { resourceSchema } from "@/schemas/resource";
import { sanitizeUsers } from "@/lib/redact";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || String(DEFAULT_PAGE_LIMIT)), MAX_PAGE_LIMIT);

  const resources = await prisma.resource.findMany({
    where: await projectFilterForRequest(session.user!.id!, req),
    include: {
      resourceMilestones: { include: { milestone: { select: { id: true, code: true, title: true } } } },
      resourceTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { name: "asc" },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
  });

  const hasMore = resources.length > limit;
  const data = hasMore ? resources.slice(0, -1) : resources;
  const nextCursor = hasMore ? data[data.length - 1]?.id : null;

  // Strip email from responses for non-PM users
  const sanitized = sanitizeUsers(data, session);

  return NextResponse.json({ data: sanitized, nextCursor });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = resourceSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;
  await requireProjectAccess(session, data.projectId, "work:edit");
  const tagIds = data.tagIds;
  const milestoneIds = data.milestoneIds;

  // Create resource and related records in a transaction
  const resource = await prisma.$transaction(async (tx) => {
    const newResource = await tx.resource.create({
      data: {
        name: data.name,
        role: data.role,
        projectId: data.projectId,
        department: data.department ?? null,
        type: data.type,
        availability: data.availability ?? null,
        dayRate: data.dayRate ?? null,
        daysPerMonth: data.daysPerMonth ?? null,
        yearlyCost: data.yearlyCost ?? null,
        status: data.status,
        notes: data.notes ?? null,
        userId: data.userId ?? null,
      },
    });

    // Handle tag creation if tagIds provided
    if (tagIds && tagIds.length > 0) {
      await tx.resourceTag.createMany({
        data: tagIds.map((tagId: string) => ({ resourceId: newResource.id, tagId })),
      });
    }

    // Handle milestone creation if milestoneIds provided
    if (milestoneIds && milestoneIds.length > 0) {
      await tx.resourceMilestone.createMany({
        data: milestoneIds.map((milestoneId: string) => ({ resourceId: newResource.id, milestoneId })),
      });
    }

    return newResource;
  });

  // Fetch the created resource with all relations (outside transaction)
  const created = await prisma.resource.findUnique({
    where: { id: resource.id },
    include: {
      resourceMilestones: { include: { milestone: true } },
      resourceTags: { include: { tag: true } },
    },
  });

  return NextResponse.json(created, { status: 201 });
});
