import { requireEntityAccess, requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler, apiError } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { getEntityCustomFields } from "@/lib/custom-fields";
import { taskUpdateSchema } from "@/schemas/task";
import {
  updateMilestoneBudgetInTx,
  updateMultipleMilestoneBudgetsInTx,
} from "@/lib/milestone-budget";
import { sanitizeTaskAssignments } from "@/lib/redact";
import { syncTaskLivingLabCosts } from "@/lib/task-living-lab-sync";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await requireEntityAccess(session, "task", id);
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      milestone: { select: { id: true, code: true, title: true } },
      taskTags: { include: { tag: true } },
      taskAssignments: { include: { user: { select: { id: true, name: true, email: true } } } },
      resource: { select: { id: true, name: true } },
    },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const customFields = await getEntityCustomFields(task.projectId, "TASK", task.id);
  // Strip email from response for non-PM users
  const [sanitized] = sanitizeTaskAssignments([task], session);
  return NextResponse.json({ ...sanitized, customFields });
});

async function handleUpdateTask(req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "task", id, "work:edit");
  const body = await req.json();

  const validation = taskUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  // Validate milestoneId if provided
  if (data.milestoneId !== undefined) {
    const milestone = await prisma.milestone.findUnique({ where: { id: data.milestoneId } });
    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }
    // Moving work into another project needs a say in that project too.
    await requireProjectAccess(session, milestone.projectId, "work:edit");
  }

  // Validate resourceId if provided
  if (data.resourceId !== undefined && data.resourceId !== null) {
    const resource = await prisma.resource.findUnique({ where: { id: data.resourceId } });
    if (!resource) {
      return NextResponse.json({ error: "Resource not found", resourceId: data.resourceId }, { status: 404 });
    }
    await requireProjectAccess(session, resource.projectId, "work:edit");
  }

  // Get the original task to check if milestone changed
  const originalTask = await prisma.task.findUnique({
    where: { id },
    select: { milestoneId: true, projectId: true },
  });

  // Extract valid Task fields only (exclude fields that aren't part of the Task model)
  const { tagIds, ownerIds, updatedAt, ...taskUpdateData } = data;
  // createLivingLabCost is not a Task model field — strip it before Prisma
  if ("createLivingLabCost" in taskUpdateData) {
    delete (taskUpdateData as Record<string, unknown>).createLivingLabCost;
  }

  // Ensure percentDone is bounded
  if (taskUpdateData.percentDone !== undefined) {
    taskUpdateData.percentDone = Math.max(0, Math.min(100, taskUpdateData.percentDone));
  }

  // Date conversion: z.string().date() gives us "YYYY-MM-DD", Prisma needs Date objects
  const dateFields = ["startDate", "dueDate"] as const;
  for (const field of dateFields) {
    const val = (taskUpdateData as Record<string, unknown>)[field];
    if (typeof val === "string") {
      (taskUpdateData as Record<string, unknown>)[field] = new Date(val);
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Build where clause with optimistic concurrency check
      const where: Prisma.TaskWhereUniqueInput & { updatedAt?: Date } = { id };
      if (updatedAt) {
        where.updatedAt = new Date(updatedAt);
      }

      // Update the task with valid fields only
      const task = await tx.task.update({
        where,
        data: taskUpdateData,
        include: {
          milestone: { select: { id: true, code: true, title: true } },
          taskTags: { include: { tag: true } },
          taskAssignments: { include: { user: { select: { id: true, name: true, email: true } } } },
          resource: { select: { id: true, name: true } },
        },
      });

      // Handle tag updates if tagIds is provided
      if (tagIds !== undefined) {
        await tx.taskTag.deleteMany({ where: { taskId: id } });
        if (tagIds.length > 0) {
          await tx.taskTag.createMany({
            data: tagIds.map((tagId: string) => ({ taskId: id, tagId })),
          });
        }
      }

      // Handle owner/assignment updates if ownerIds is provided
      if (ownerIds !== undefined) {
        await tx.taskAssignment.deleteMany({ where: { taskId: id } });
        if (ownerIds.length > 0) {
          await tx.taskAssignment.createMany({
            data: ownerIds.map((userId: string) => ({ taskId: id, userId, role: "OWNER" })),
          });
        }
      }

      // Sync Living Lab costs
      if (data.estBudget !== undefined || data.actualSpend !== undefined || data.extCosts !== undefined) {
        await syncTaskLivingLabCosts(tx, task);
      }

      // Update milestone budget totals
      const milestoneIdsToUpdate = new Set<string>();
      milestoneIdsToUpdate.add(task.milestoneId);

      // If milestone changed, update both old and new milestones
      if (originalTask && originalTask.milestoneId !== task.milestoneId) {
        milestoneIdsToUpdate.add(originalTask.milestoneId);
      }

      await updateMultipleMilestoneBudgetsInTx(tx, Array.from(milestoneIdsToUpdate));

      return task;
    });

    // Revalidate cache
    revalidatePath("/tasks");
    revalidatePath("/milestones");
    revalidatePath("/gantt");
    if (result.milestone?.id) {
      revalidatePath(`/milestones/${result.milestone.id}`);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025: record not found — can be from optimistic concurrency or actual missing record
      if (error.code === "P2025") {
        return apiError("This record was modified by someone else", 409, {
          code: "CONFLICT",
        });
      }
      // P2002: unique constraint (code conflict)
      if (error.code === "P2002") {
        return apiError("A task with this code already exists", 409);
      }
      // P2003: foreign key violation
      if (error.code === "P2003") {
        return apiError("Referenced record not found", 400, {
          field: error.meta?.field_name ?? undefined,
        });
      }
    }
    throw error; // re-throw for withErrorHandler to catch
  }
}

export const PUT = withErrorHandler(handleUpdateTask);
export const PATCH = withErrorHandler(handleUpdateTask);

export const DELETE = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "task", id, "work:edit");

  try {
    // Get the task's milestone before deleting
    const task = await prisma.task.findUnique({
      where: { id },
      select: { milestoneId: true },
    });

    await prisma.$transaction(async (tx) => {
      // Clean up any synced Living Lab cost entries before deleting the task
      await tx.livingLabCost.deleteMany({ where: { taskId: id } });
      await tx.task.delete({ where: { id } });

      // Update milestone budget totals
      if (task) {
        await updateMilestoneBudgetInTx(tx, task.milestoneId);
      }
    });

    // Revalidate cache
    revalidatePath("/tasks");
    revalidatePath("/milestones");
    revalidatePath("/gantt");
    if (task?.milestoneId) {
      revalidatePath(`/milestones/${task.milestoneId}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
    }
    // Anything else (including an archived project) is the shared handler's to log and answer.
    throw error;
  }
});
