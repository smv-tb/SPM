import { prisma } from "@/lib/prisma";
import { milestoneCreateSchema, milestoneUpdateSchema } from "@/schemas/milestone";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { updateMilestoneBudgetInTx } from "@/lib/milestone-budget";
import {
  parsePagination, paginateResponse, toDate, DATE_PROP, MILESTONE_STATUS_PROP, PRIORITY_PROP,
  LIST_SHAPE_PROPS, PATCH_NOTE, parseFields, pickFields, diffFields,
} from "./_shared";

export function registerMilestoneTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("milestone_list", defineTool(
    "List milestones with cursor-based pagination. `summary: true` drops the nested phase/parent/children objects; `fields` returns a sparse fieldset.",
    {
      type: "object",
      properties: {
        cursor: { type: "string" }, limit: { type: "number" },
        projectId: { type: "string" }, phaseId: { type: "string" }, status: MILESTONE_STATUS_PROP,
        ...LIST_SHAPE_PROPS,
      },
    },
    async (args) => {
      return tryCatchTool(async () => {
        const { take, cursor, skip } = parsePagination(args);
        const where: Record<string, unknown> = {};
        if (args.projectId) where.projectId = String(args.projectId);
        if (args.phaseId) where.phaseId = String(args.phaseId);
        if (args.status) where.status = String(args.status);
        const milestones = await prisma.milestone.findMany({
          where,
          include: { phase: { select: { id: true, name: true, color: true } }, parent: { select: { id: true, code: true, title: true } }, children: { select: { id: true, code: true, title: true } }, _count: { select: { tasks: true } } },
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }], take, cursor, skip,
        });
        const { data, nextCursor } = paginateResponse(milestones, take - 1);
        const fields = parseFields(args);
        const rows = data.map((m) => {
          if (args.summary !== true) return pickFields(m, fields);
          return pickFields({
            id: m.id, code: m.code, title: m.title, status: m.status, priority: m.priority,
            startDate: m.startDate.toISOString().slice(0, 10), dueDate: m.dueDate.toISOString().slice(0, 10),
            phaseId: m.phaseId, phaseName: m.phase?.name ?? null, parentCode: m.parent?.code ?? null,
            estBudget: m.estBudget === null ? null : m.estBudget.toNumber(),
            actualSpend: m.actualSpend === null ? null : m.actualSpend.toNumber(),
            taskCount: m._count.tasks,
          }, fields);
        });
        return createToolResponse({ data: rows, nextCursor });
      });
    }
  ));

  handlers.set("milestone_get", defineTool(
    "Get a single milestone by ID with full relations",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const ms = await prisma.milestone.findUnique({
          where: { id: String(id) },
          include: { phase: true, parent: { select: { id: true, code: true, title: true } }, children: { include: { _count: { select: { tasks: true } } } }, tasks: { include: { taskAssignments: { include: { user: { select: { id: true, name: true } } } }, taskTags: { include: { tag: true } } }, orderBy: { orderIndex: "asc" } } },
        });
        if (!ms) return createToolResponse({ error: "Milestone not found" });
        return createToolResponse(ms);
      });
    }
  ));

  handlers.set("milestone_create", defineTool(
    "Create a new milestone",
    {
      type: "object",
      properties: {
        projectId: { type: "string" }, code: { type: "string" }, title: { type: "string" },
        phaseId: { type: "string" }, parentId: { type: "string" }, description: { type: "string" },
        startDate: DATE_PROP, dueDate: DATE_PROP,
        status: MILESTONE_STATUS_PROP, priority: PRIORITY_PROP,
        estBudget: { type: "number" }, orderIndex: { type: "number" },
      },
      required: ["projectId", "code", "title"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = milestoneCreateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const ms = await prisma.milestone.create({
          data: { code: data.code, title: data.title, projectId: data.projectId, description: data.description ?? null, phaseId: data.phaseId ?? null, parentId: data.parentId ?? null, startDate: toDate(data.startDate) ?? new Date(), dueDate: toDate(data.dueDate) ?? new Date(), status: data.status, priority: data.priority, estBudget: data.estBudget ?? null, orderIndex: data.orderIndex ?? 0 },
          include: { phase: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
        });
        return createToolResponse(ms);
      });
    }
  ));

  handlers.set("milestone_update", defineTool(
    `Update an existing milestone. ${PATCH_NOTE} Pass phaseId/parentId as null to clear them.`,
    {
      type: "object",
      properties: {
        id: { type: "string" }, code: { type: "string" }, title: { type: "string" },
        description: { type: "string" }, phaseId: { type: ["string", "null"] }, parentId: { type: ["string", "null"] },
        startDate: DATE_PROP, dueDate: DATE_PROP,
        status: MILESTONE_STATUS_PROP, priority: PRIORITY_PROP,
        estBudget: { type: "number" }, actualSpend: { type: "number" }, orderIndex: { type: "number" },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = milestoneUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const updateData: Record<string, unknown> = {};
        if (data.code !== undefined) updateData.code = data.code;
        if (data.title !== undefined) updateData.title = data.title;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.phaseId !== undefined) updateData.phaseId = data.phaseId;
        if (data.parentId !== undefined) updateData.parentId = data.parentId;
        if (data.startDate !== undefined) updateData.startDate = toDate(data.startDate);
        if (data.dueDate !== undefined) updateData.dueDate = toDate(data.dueDate);
        if (data.status !== undefined) updateData.status = data.status;
        if (data.priority !== undefined) updateData.priority = data.priority;
        if (data.estBudget !== undefined) updateData.estBudget = data.estBudget;
        if (data.actualSpend !== undefined) updateData.actualSpend = data.actualSpend;
        if (data.orderIndex !== undefined) updateData.orderIndex = data.orderIndex;
        const before = await prisma.milestone.findUnique({ where: { id } });
        if (!before) return createToolResponse({ error: "Milestone not found" });
        const start = (updateData.startDate as Date | undefined) ?? before.startDate;
        const due = (updateData.dueDate as Date | undefined) ?? before.dueDate;
        if ((data.startDate !== undefined || data.dueDate !== undefined) && start > due) {
          return createToolResponse({ error: `startDate ${start.toISOString().slice(0, 10)} would be after dueDate ${due.toISOString().slice(0, 10)}` });
        }
        const ms = await prisma.milestone.update({ where: { id }, data: updateData });
        return createToolResponse({ ...ms, changes: diffFields(before, ms) });
      });
    }
  ));

  handlers.set("milestone_delete", defineTool(
    "Delete a milestone (cascade deletes its tasks and updates parent budget). Returns what was removed.",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const ms = await prisma.milestone.findUnique({
          where: { id: String(id) },
          include: { children: { select: { id: true } }, parent: { select: { id: true } }, tasks: { select: { id: true, code: true } } },
        });
        if (!ms) return createToolResponse({ error: "Milestone not found" });
        if (ms.children.length > 0) return createToolResponse({ error: "Cannot delete milestone with sub-milestones" });

        const parentId = ms.parent?.id;
        const removedCosts = await prisma.$transaction(async (tx) => {
          // Tasks cascade, but their mirrored Living Lab cost rows would only
          // get taskId nulled — turning them into double-counted standalone spend.
          const costs = await tx.livingLabCost.deleteMany({ where: { task: { milestoneId: ms.id } } });
          await tx.milestone.delete({ where: { id: ms.id } });
          if (parentId) await updateMilestoneBudgetInTx(tx, parentId);
          return costs.count;
        });

        return createToolResponse({
          ok: true,
          deleted: { id: ms.id, code: ms.code, title: ms.title },
          deletedTasks: ms.tasks.map((t) => t.code),
          removedLivingLabCosts: removedCosts,
        });
      });
    }
  ));
}
