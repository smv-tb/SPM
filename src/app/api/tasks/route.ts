export const dynamic = "force-dynamic";
import { requireProjectAccess } from "@/lib/project-access";
import { logWarn } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { projectFilterForRequest } from "@/lib/current-project";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { withErrorHandler, apiError } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/constants";
import { taskCreateSchema } from "@/schemas/task";
import { updateMilestoneBudgetInTx } from "@/lib/milestone-budget";
import { sanitizeTaskAssignments } from "@/lib/redact";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || String(DEFAULT_PAGE_LIMIT)), MAX_PAGE_LIMIT);

  const tasks = await prisma.task.findMany({
    where: await projectFilterForRequest(session.user!.id!, req),
    include: {
      milestone: { select: { id: true, code: true, title: true } },
      taskTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      taskAssignments: { include: { user: { select: { id: true, name: true, email: true } } } },
      resource: { select: { id: true, name: true } },
    },
    orderBy: [{ milestone: { orderIndex: "asc" } }, { orderIndex: "asc" }],
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
  });

  const hasMore = tasks.length > limit;
  const data = hasMore ? tasks.slice(0, -1) : tasks;
  const nextCursor = hasMore ? data[data.length - 1]?.id : null;

  // Strip email from responses for non-PM users
  const sanitized = sanitizeTaskAssignments(data, session);

  return NextResponse.json({ data: sanitized, nextCursor });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = taskCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }
  const data = validation.data;
  const { title, milestoneId, code, startDate, dueDate, status, priority, percentDone, estBudget, actualSpend, extCosts, costCategoryId, notes, tagIds, ownerIds, resourceId } = data;

  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  await requireProjectAccess(session, milestone.projectId, "work:edit");

  const msCode = milestone.code.replace(/[^A-Z0-9]/gi, "").toUpperCase() || "MS";

  // --- Phase 1: Code generation (outside transaction, can retry safely) ---
  let autoCode: string;
  let retryAttempt = 0;
  const maxRetries = 10;

  while (true) {
    const taskCount = await prisma.task.count({ where: { milestoneId } });
    const seqNum = String(taskCount + 1 + retryAttempt).padStart(3, "0");
    autoCode = code || `${msCode}-${seqNum}`;

    // Check if this code already exists
    const existing = await prisma.task.findFirst({ where: { code: autoCode } });
    if (!existing || code) break; // If user provided code, don't retry; if auto-code is unique, proceed

    retryAttempt++;
    if (retryAttempt >= maxRetries) {
      return apiError("Failed to generate unique task code", 409);
    }

    // Check if we're in a unique-constraint race (code taken between findUnique and create)
    // We'll use a pre-check + retry; continue loop
  }

  // Convert date strings to Date objects
  const resolvedStartDate = startDate ? new Date(startDate) : new Date();
  const resolvedDueDate = dueDate ? new Date(dueDate) : new Date();

  // --- Phase 2: Transactional write ---
  try {
    const task = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title,
          milestoneId,
          projectId: milestone.projectId,
          code: autoCode,
          startDate: resolvedStartDate,
          dueDate: resolvedDueDate,
          status,
          priority,
          percentDone,
          estBudget,
          actualSpend,
          extCosts,
          costCategoryId: costCategoryId ?? null,
          notes: notes ?? null,
          resourceId: resourceId ?? null,
          taskTags: tagIds?.length ? { create: tagIds.map((tagId: string) => ({ tagId })) } : undefined,
          taskAssignments: ownerIds?.length ? { create: ownerIds.map((userId: string) => ({ userId, role: "OWNER" as const })) } : undefined,
        },
        include: {
          milestone: { select: { id: true, code: true, title: true } },
          taskTags: { include: { tag: true } },
          taskAssignments: { include: { user: { select: { id: true, name: true, email: true } } } },
          resource: { select: { id: true, name: true } },
        },
      });

      // Synchronize with Living Lab costs if explicitly requested
      const createLivingLabCost = body.createLivingLabCost === true;
      if (createLivingLabCost && (estBudget != null || actualSpend != null || extCosts != null)) {
        const livingLabs = await tx.livingLab.findMany({
          where: { projectId: milestone.projectId },
        });

        if (livingLabs.length > 0) {
          const labId = livingLabs[0].id;
          await tx.livingLabCost.create({
            data: {
              labId,
              taskId: task.id,
              costCategoryId: costCategoryId ?? null,
              estBudget: estBudget ?? 0,
              actualSpend: actualSpend ?? 0,
              startDate: resolvedStartDate,
            },
          });
        }
      }

      // Update milestone budget totals
      await updateMilestoneBudgetInTx(tx, milestoneId);

      return task;
    });

    // Revalidate cache
    revalidatePath("/tasks");
    revalidatePath("/milestones");
    revalidatePath("/gantt");
    revalidatePath(`/milestones/${milestoneId}`);

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    // If the auto-code raced with another creation, retry
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      !code &&
      retryAttempt < maxRetries
    ) {
      // Tail-recursive retry: re-enter the code-gen loop
      // We reach here only if the pre-check found no collision but creation raced.
      // The outer POST handler doesn't support seamless retry with new counts,
      // but this is extremely rare. Log and return 409.
      logWarn("tasks", "code race detected", { autoCode });
      return apiError("Code collision — please retry", 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return apiError("A task with this code already exists", 409);
    }
    throw error;
  }
});
