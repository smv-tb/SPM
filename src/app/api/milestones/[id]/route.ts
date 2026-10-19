import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler, apiError } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { milestoneUpdateSchema } from "@/schemas/milestone";
import { updateMilestoneBudgetInTx } from "@/lib/milestone-budget";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await requireEntityAccess(session, "milestone", id);
  const ms = await prisma.milestone.findUnique({
    where: { id },
    include: {
      phase: true,
      parent: { select: { id: true, code: true, title: true } },
      children: { include: { _count: { select: { tasks: true } } } },
      tasks: { include: { taskAssignments: { include: { user: { select: { id: true, name: true } } } }, taskTags: { include: { tag: true } } }, orderBy: { orderIndex: "asc" } },
    },
  });
  if (!ms) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(ms);
});

async function handleUpdateMilestone(req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "milestone", id, "work:edit");
  const body = await req.json();

  const validation = milestoneUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;
  const { updatedAt, ...milestoneFields } = data;
  const updateData: Record<string, unknown> = {};

  if (milestoneFields.code !== undefined) updateData.code = milestoneFields.code;
  if (milestoneFields.title !== undefined) updateData.title = milestoneFields.title;
  if (milestoneFields.description !== undefined) updateData.description = milestoneFields.description;
  if (milestoneFields.phaseId !== undefined) updateData.phaseId = milestoneFields.phaseId;
  if (milestoneFields.parentId !== undefined) updateData.parentId = milestoneFields.parentId;
  if (milestoneFields.startDate !== undefined) updateData.startDate = new Date(milestoneFields.startDate);
  if (milestoneFields.dueDate !== undefined) updateData.dueDate = new Date(milestoneFields.dueDate);
  if (milestoneFields.status !== undefined) updateData.status = milestoneFields.status;
  if (milestoneFields.priority !== undefined) updateData.priority = milestoneFields.priority;
  if (milestoneFields.estBudget !== undefined) updateData.estBudget = milestoneFields.estBudget;
  if (milestoneFields.actualSpend !== undefined) updateData.actualSpend = milestoneFields.actualSpend;

  try {
    const ms = await prisma.$transaction(async (tx) => {
      // Build where clause with optimistic concurrency check
      const where: Prisma.MilestoneWhereUniqueInput & { updatedAt?: Date } = { id };
      if (updatedAt) {
        where.updatedAt = new Date(updatedAt);
      }

      const ms = await tx.milestone.update({ where, data: updateData });

      // Update budget for this and parent milestones
      await updateMilestoneBudgetInTx(tx, id);

      return ms;
    });

    // Revalidate cache
    revalidatePath("/tasks");
    revalidatePath("/milestones");
    revalidatePath("/gantt");
    revalidatePath(`/milestones/${id}`);

    return NextResponse.json(ms);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return apiError("A milestone with this code already exists", 409);
      }
      if (error.code === "P2025") {
        return apiError("This record was modified by someone else", 409, {
          code: "CONFLICT",
        });
      }
      if (error.code === "P2003") {
        const field = error.meta?.field_name as string | undefined;
        // Map foreign key field names to user-friendly messages
        if (field?.includes("parentId")) {
          return apiError("Parent milestone not found", 400, { field: "parentId" });
        }
        if (field?.includes("phaseId")) {
          return apiError("Phase not found", 400, { field: "phaseId" });
        }
        return apiError("Referenced record not found", 400, { field });
      }
    }
    throw error; // re-throw for withErrorHandler to catch
  }
}

export const PUT = withErrorHandler(handleUpdateMilestone);
export const PATCH = withErrorHandler(handleUpdateMilestone);

export const DELETE = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "milestone", id, "work:edit");

  try {
    // Get the milestone with parent info before deleting
    const milestone = await prisma.milestone.findUnique({
      where: { id },
      include: { children: { select: { id: true } }, parent: { select: { id: true } } },
    });

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    if (milestone.children.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete milestone with sub-milestones. Delete sub-milestones first." },
        { status: 409 }
      );
    }

    const parentId = milestone.parent?.id ?? null;

    await prisma.$transaction(async (tx) => {
      // Tasks cascade with the milestone, but their mirrored Living Lab cost
      // rows only get taskId nulled — which turns them into standalone spend
      // and double-counts it. Remove them with their tasks.
      await tx.livingLabCost.deleteMany({ where: { task: { milestoneId: id } } });
      await tx.milestone.delete({ where: { id } });

      // Update parent milestone budget if applicable
      if (parentId) {
        await updateMilestoneBudgetInTx(tx, parentId);
      }
    });

    // Revalidate cache
    revalidatePath("/tasks");
    revalidatePath("/milestones");
    revalidatePath("/gantt");
    if (parentId) {
      revalidatePath(`/milestones/${parentId}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
      }
    }
    // Anything else (including an archived project) is the shared handler's to log and answer.
    throw error;
  }
});
