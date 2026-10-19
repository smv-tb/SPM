export const dynamic = "force-dynamic";
import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { resourceUpdateSchema } from "@/schemas/resource";
import { sanitizeUsers } from "@/lib/redact";

type RouteContext = { params: Promise<{ id: string }> };

// Custom error class for DELETE transaction flow control
class DeleteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "DeleteError";
  }
}

export const GET = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await requireEntityAccess(session, "resource", id);
  const resource = await prisma.resource.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
      resourceMilestones: { include: { milestone: true } },
      resourceTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
  });

  if (!resource) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  // Strip email from response for non-PM users
  const [sanitized] = sanitizeUsers([resource], session);
  return NextResponse.json(sanitized);
});

export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "resource", id, "work:edit");
  const body = await req.json();

  const validation = resourceUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  const existing = await prisma.resource.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  // Extract tagIds and milestoneIds from the data
  const { tagIds, milestoneIds, ...updateFields } = data as Record<string, unknown> & { tagIds?: string[]; milestoneIds?: string[] };

  // Update resource and related records in a transaction
  await prisma.$transaction(async (tx) => {
    // Update the main resource fields
    await tx.resource.update({
      where: { id },
      data: updateFields,
    });

    // Handle milestone updates if provided
    if (milestoneIds !== undefined) {
      await tx.resourceMilestone.deleteMany({ where: { resourceId: id } });
      if (Array.isArray(milestoneIds) && milestoneIds.length > 0) {
        await tx.resourceMilestone.createMany({
          data: milestoneIds.map((milestoneId: string) => ({ resourceId: id, milestoneId })),
        });
      }
    }

    // Handle tag updates if provided
    if (tagIds !== undefined) {
      await tx.resourceTag.deleteMany({ where: { resourceId: id } });
      if (Array.isArray(tagIds) && tagIds.length > 0) {
        await tx.resourceTag.createMany({
          data: tagIds.map((tagId: string) => ({ resourceId: id, tagId })),
        });
      }
    }
  });

  // Fetch the updated resource with all relations (outside transaction)
  const result = await prisma.resource.findUnique({
    where: { id },
    include: {
      resourceMilestones: { include: { milestone: true } },
      resourceTags: { include: { tag: true } },
    },
  });

  return NextResponse.json(result);
});

export const DELETE = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "resource", id, "work:edit");

  try {
    await prisma.$transaction(async (tx) => {
      const resource = await tx.resource.findUnique({
        where: { id },
        include: { resourceMilestones: true },
      });

      if (!resource) throw new DeleteError("Resource not found", 404);

      const msCount = resource.resourceMilestones.length;
      if (msCount > 0) {
        throw new DeleteError("Cannot delete resource with assigned milestones. Remove milestone assignments first.", 409);
      }

      return tx.resource.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DeleteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error; // re-throw for withErrorHandler
  }
});
