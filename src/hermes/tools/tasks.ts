import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { taskCreateSchema, taskUpdateSchema, type TaskUpdateInput } from "@/schemas/task";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import {
  parsePagination, paginateResponse, clampPercent, standardIncludes, toDate,
  DATE_PROP, TASK_STATUS_PROP, PRIORITY_PROP, LIST_SHAPE_PROPS, PATCH_NOTE, MAX_BULK_ITEMS,
  parseFields, pickFields, diffFields, diffIdSet, resolveOwner, type FieldChanges,
} from "./_shared";
import { updateMilestoneBudget, updateMultipleMilestoneBudgetsInTx } from "@/lib/milestone-budget";
import { syncTaskLivingLabCosts } from "@/lib/task-living-lab-sync";

type TaskWithIncludes = Prisma.TaskGetPayload<{ include: typeof standardIncludes }>;

const TASK_WRITE_PROPERTIES = {
  title: { type: "string" }, milestoneId: { type: "string" },
  code: { type: "string" }, description: { type: "string" },
  startDate: DATE_PROP, dueDate: DATE_PROP,
  percentDone: { type: "number" }, status: TASK_STATUS_PROP, priority: PRIORITY_PROP,
  estBudget: { type: "number" }, actualSpend: { type: "number" }, extCosts: { type: "number" },
  costCategoryId: { type: "string" }, notes: { type: "string" },
  tagIds: { type: "array", items: { type: "string" }, description: "Replaces the full tag set." },
  ownerIds: { type: "array", items: { type: "string" }, description: "User IDs. Replaces all task assignments with these users as OWNER." },
  resourceId: { type: ["string", "null"], description: "Linked Resource (team member/partner row). Separate from ownerIds." },
  orderIndex: { type: "number" },
} as const;

const TASK_UPDATE_ITEM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    ...TASK_WRITE_PROPERTIES,
    updatedAt: { type: "string", description: "Optional optimistic-concurrency guard: the updatedAt you last read. The write is refused if the task changed since." },
  },
  required: ["id"],
} as const;

/** A full task row with its owner resolved (see `resolveOwner`). */
function presentTask(task: TaskWithIncludes) {
  return { ...task, ...resolveOwner(task) };
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

function summarizeTask(task: TaskWithIncludes) {
  const { owner } = resolveOwner(task);
  return {
    id: task.id, code: task.code, title: task.title,
    status: task.status, priority: task.priority, percentDone: task.percentDone,
    startDate: dateOnly(task.startDate), dueDate: dateOnly(task.dueDate),
    milestoneId: task.milestoneId, milestoneCode: task.milestone?.code ?? null,
    estBudget: num(task.estBudget), actualSpend: num(task.actualSpend), extCosts: num(task.extCosts),
    owner: owner?.name ?? null, ownerSource: owner?.source ?? null,
  };
}

class TaskUpdateError extends Error {}

/** Thrown to roll a dry-run transaction back once its diffs are computed. */
class DryRunRollback extends Error {
  constructor(public readonly results: unknown) { super("dry run"); }
}

/**
 * Applies one validated partial update inside `tx`. Only fields present in
 * `data` are written. Returns the updated task and the fields that changed.
 * Milestone budgets are left to the caller, so a bulk update recalculates each
 * milestone once rather than once per task.
 */
async function applyTaskUpdate(
  tx: Prisma.TransactionClient,
  id: string,
  data: TaskUpdateInput,
  touchedMilestones: Set<string>
): Promise<{ task: TaskWithIncludes; changes: FieldChanges }> {
  const before = await tx.task.findUnique({ where: { id }, include: standardIncludes });
  if (!before) throw new TaskUpdateError(`Task not found: ${id}`);

  const { tagIds, ownerIds, updatedAt, createLivingLabCost: _ignored, projectId: _projectId, ...fields } = data;
  void _ignored; void _projectId;

  if (updatedAt !== undefined && before.updatedAt.getTime() !== new Date(updatedAt).getTime()) {
    throw new TaskUpdateError(
      `Task ${before.code} changed since it was read (updatedAt is ${before.updatedAt.toISOString()}). Re-read it and retry.`
    );
  }

  const update: Prisma.TaskUncheckedUpdateInput = { ...fields };
  if (fields.milestoneId !== undefined && fields.milestoneId !== before.milestoneId) {
    const ms = await tx.milestone.findUnique({ where: { id: fields.milestoneId }, select: { projectId: true } });
    if (!ms) throw new TaskUpdateError(`Milestone not found: ${fields.milestoneId}`);
    update.projectId = ms.projectId;
  }
  if (fields.resourceId) {
    const resource = await tx.resource.findUnique({ where: { id: fields.resourceId }, select: { id: true } });
    if (!resource) throw new TaskUpdateError(`Resource not found: ${fields.resourceId}`);
  }
  if (fields.percentDone !== undefined) update.percentDone = clampPercent(fields.percentDone);
  if (fields.startDate !== undefined) update.startDate = toDate(fields.startDate);
  if (fields.dueDate !== undefined) update.dueDate = toDate(fields.dueDate);

  if (fields.startDate !== undefined || fields.dueDate !== undefined) {
    const start = (update.startDate as Date | undefined) ?? before.startDate;
    const due = (update.dueDate as Date | undefined) ?? before.dueDate;
    if (start > due) {
      throw new TaskUpdateError(`Task ${before.code}: startDate ${dateOnly(start)} would be after dueDate ${dateOnly(due)}`);
    }
  }

  await tx.task.update({ where: { id }, data: update });

  if (tagIds !== undefined) {
    await tx.taskTag.deleteMany({ where: { taskId: id } });
    if (tagIds.length > 0) await tx.taskTag.createMany({ data: [...new Set(tagIds)].map((tagId) => ({ taskId: id, tagId })) });
  }
  if (ownerIds !== undefined) {
    await tx.taskAssignment.deleteMany({ where: { taskId: id } });
    if (ownerIds.length > 0) {
      await tx.taskAssignment.createMany({ data: [...new Set(ownerIds)].map((userId) => ({ taskId: id, userId, role: "OWNER" as const })) });
    }
  }

  const task = await tx.task.findUniqueOrThrow({ where: { id }, include: standardIncludes });

  if (fields.estBudget !== undefined || fields.actualSpend !== undefined || fields.extCosts !== undefined) {
    await syncTaskLivingLabCosts(tx, task);
  }

  touchedMilestones.add(task.milestoneId);
  if (before.milestoneId !== task.milestoneId) touchedMilestones.add(before.milestoneId);

  const changes = diffFields(before, task);
  diffIdSet(changes, "tagIds", before.taskTags.map((t) => t.tagId), tagIds);
  diffIdSet(
    changes, "ownerIds",
    before.taskAssignments.filter((a) => a.role === "OWNER").map((a) => a.userId),
    ownerIds === undefined ? undefined : ownerIds
  );
  return { task, changes };
}

export function registerTaskTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("task_list", defineTool(
    "List tasks with cursor-based pagination and optional filters. Each full row includes a resolved `owner` " +
      "({ name, source: resource|assignment|collaborator }) plus `owners`/`collaborators` — a null resourceId does NOT mean unassigned. " +
      "Use `summary: true` for compact rows (~1/10 the size) or `fields` for a sparse fieldset.",
    {
      type: "object",
      properties: {
        cursor: { type: "string" }, limit: { type: "number" },
        projectId: { type: "string" }, milestoneId: { type: "string" },
        status: TASK_STATUS_PROP, priority: PRIORITY_PROP,
        ownerUserId: { type: "string", description: "Only tasks assigned to this user" },
        search: { type: "string", description: "Matches title or code (punctuation-insensitive for codes)" },
        ...LIST_SHAPE_PROPS,
      },
    },
    async (args) => {
      return tryCatchTool(async () => {
        const { take, cursor, skip } = parsePagination(args);
        const where: Prisma.TaskWhereInput = {};
        if (args.projectId) where.projectId = String(args.projectId);
        if (args.milestoneId) where.milestoneId = String(args.milestoneId);
        if (args.status) where.status = String(args.status) as Prisma.TaskWhereInput["status"];
        if (args.priority) where.priority = String(args.priority) as Prisma.TaskWhereInput["priority"];
        if (args.ownerUserId) where.taskAssignments = { some: { userId: String(args.ownerUserId) } };
        if (args.search) {
          const q = String(args.search);
          where.OR = [
            { title: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
          ];
        }
        const tasks = await prisma.task.findMany({
          where, include: standardIncludes,
          orderBy: [{ milestone: { orderIndex: "asc" } }, { orderIndex: "asc" }, { id: "asc" }],
          take, cursor, skip,
        });
        const { data, nextCursor } = paginateResponse(tasks, take - 1);
        const fields = parseFields(args);
        const rows = args.summary === true
          ? data.map((t) => pickFields(summarizeTask(t), fields))
          : data.map((t) => pickFields(presentTask(t), fields));
        return createToolResponse({ data: rows, nextCursor });
      });
    }
  ));

  handlers.set("task_get", defineTool(
    "Get a single task by ID with all relations and its resolved owner",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const task = await prisma.task.findUnique({ where: { id: String(id) }, include: standardIncludes });
        if (!task) return createToolResponse({ error: "Task not found" });
        return createToolResponse(presentTask(task));
      });
    }
  ));

  handlers.set("task_create", defineTool(
    "Create a new task",
    {
      type: "object",
      properties: { ...TASK_WRITE_PROPERTIES, createLivingLabCost: { type: "boolean" } },
      required: ["milestoneId", "title"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = taskCreateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const { title, milestoneId, code, startDate, dueDate, status, priority, percentDone, estBudget, actualSpend, extCosts, costCategoryId, notes, tagIds, ownerIds, resourceId } = data;
        const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
        if (!milestone) return createToolResponse({ error: "Milestone not found" });
        const taskCount = await prisma.task.count({ where: { milestoneId } });
        const msCode = milestone.code.replace(/[^A-Z0-9]/gi, "").toUpperCase() || "MS";
        const autoCode = code || `${msCode}-${String(taskCount + 1).padStart(3, "0")}`;
        const task = await prisma.task.create({
          data: {
            title, milestoneId, projectId: milestone.projectId, code: autoCode,
            startDate: toDate(startDate) ?? new Date(), dueDate: toDate(dueDate) ?? new Date(),
            status: status ?? "BACKLOG", priority: priority ?? "MED",
            percentDone: percentDone ?? 0, estBudget, actualSpend, extCosts,
            costCategoryId: costCategoryId ?? null, notes: notes ?? null, resourceId: resourceId ?? null,
            taskTags: tagIds?.length ? { create: tagIds.map((tid: string) => ({ tagId: tid })) } : undefined,
            taskAssignments: ownerIds?.length ? { create: ownerIds.map((uid: string) => ({ userId: uid, role: "OWNER" as const })) } : undefined,
          },
          include: standardIncludes,
        });
        if ((args.createLivingLabCost as boolean) && (estBudget != null || actualSpend != null)) {
          const livingLabs = await prisma.livingLab.findMany({ where: { projectId: milestone.projectId } });
          if (livingLabs.length > 0) {
            await prisma.livingLabCost.create({
              data: { labId: livingLabs[0].id, taskId: task.id, costCategoryId: costCategoryId ?? null, estBudget: estBudget ?? 0, actualSpend: actualSpend ?? 0, startDate: toDate(startDate) ?? new Date() },
            });
          }
        }

        // Update milestone budget totals
        await updateMilestoneBudget(milestoneId);

        return createToolResponse(presentTask(task));
      });
    }
  ));

  handlers.set("task_update", defineTool(
    `Update an existing task. ${PATCH_NOTE} Money changes are mirrored into the project's Living Lab cost rows, as in the web app.`,
    TASK_UPDATE_ITEM_SCHEMA,
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = taskUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        try {
          const { task, changes } = await prisma.$transaction(async (tx) => {
            const touched = new Set<string>();
            const result = await applyTaskUpdate(tx, id, validation.data, touched);
            await updateMultipleMilestoneBudgetsInTx(tx, [...touched]);
            return result;
          }, { timeout: 30_000 });
          return createToolResponse({ ...presentTask(task), changes });
        } catch (error) {
          if (error instanceof TaskUpdateError) return createToolResponse({ error: error.message });
          throw error;
        }
      });
    }
  ));

  handlers.set("task_bulk_update", defineTool(
    `Update many tasks in one atomic call (all or nothing, max ${MAX_BULK_ITEMS}). Either pass \`updates\` ` +
      "(a list of per-task partial updates) or `ids` + `set` (the same partial update applied to every id). " +
      "Every item is validated before anything is written. Use `dryRun: true` to see the per-task `changes` without saving. " +
      "Returns { updated, results: [{ id, code, changes }] }.",
    {
      type: "object",
      properties: {
        updates: { type: "array", items: TASK_UPDATE_ITEM_SCHEMA },
        ids: { type: "array", items: { type: "string" } },
        set: { type: "object", properties: TASK_WRITE_PROPERTIES },
        dryRun: { type: "boolean" },
      },
    },
    async (args) => {
      return tryCatchTool(async () => {
        let items: Record<string, unknown>[];
        if (Array.isArray(args.updates)) {
          items = args.updates as Record<string, unknown>[];
        } else if (Array.isArray(args.ids) && args.set && typeof args.set === "object") {
          items = (args.ids as unknown[]).map((id) => ({ ...(args.set as Record<string, unknown>), id }));
        } else {
          return createToolResponse({ error: "Provide either `updates` or both `ids` and `set`" });
        }
        if (items.length === 0) return createToolResponse({ updated: 0, results: [] });
        if (items.length > MAX_BULK_ITEMS) return createToolResponse({ error: `Too many items (${items.length}); max ${MAX_BULK_ITEMS} per call` });

        const parsed: { id: string; data: TaskUpdateInput }[] = [];
        const errors: { index: number; id: unknown; error: unknown }[] = [];
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (typeof item?.id !== "string" || !item.id) return errors.push({ index, id: item?.id, error: "id is required" });
          if (seen.has(item.id)) return errors.push({ index, id: item.id, error: "duplicate id in this batch" });
          seen.add(item.id);
          const v = taskUpdateSchema.safeParse(item);
          if (!v.success) return errors.push({ index, id: item.id, error: v.error.flatten().fieldErrors });
          parsed.push({ id: item.id, data: v.data });
        });
        if (errors.length > 0) return createToolResponse({ error: "Validation failed; nothing was written", errors });

        const dryRun = args.dryRun === true;
        try {
          const results = await prisma.$transaction(async (tx) => {
            const touched = new Set<string>();
            const out: { id: string; code: string; changes: FieldChanges }[] = [];
            for (const { id, data } of parsed) {
              const { task, changes } = await applyTaskUpdate(tx, id, data, touched);
              out.push({ id, code: task.code, changes });
            }
            await updateMultipleMilestoneBudgetsInTx(tx, [...touched]);
            if (dryRun) throw new DryRunRollback(out);
            return out;
          }, { timeout: 120_000, maxWait: 10_000 });
          return createToolResponse({ updated: results.length, results });
        } catch (error) {
          if (error instanceof DryRunRollback) {
            return createToolResponse({ dryRun: true, wouldUpdate: parsed.length, results: error.results });
          }
          if (error instanceof TaskUpdateError) return createToolResponse({ error: `${error.message}. Nothing was written.` });
          throw error;
        }
      });
    }
  ));

  handlers.set("task_delete", defineTool(
    "Delete a task (cleans up related LivingLabCost records). Returns what was removed.",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const task = await prisma.task.findUnique({
          where: { id: String(id) },
          select: { id: true, code: true, title: true, milestoneId: true },
        });
        if (!task) return createToolResponse({ error: "Task not found" });

        const removed = await prisma.$transaction(async (tx) => {
          const costs = await tx.livingLabCost.deleteMany({ where: { taskId: task.id } });
          await tx.task.delete({ where: { id: task.id } });
          await updateMultipleMilestoneBudgetsInTx(tx, [task.milestoneId]);
          return costs.count;
        });

        return createToolResponse({ ok: true, deleted: { id: task.id, code: task.code, title: task.title }, removedLivingLabCosts: removed });
      });
    }
  ));
}
