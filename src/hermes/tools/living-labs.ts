import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  livingLabCostCreateSchema, livingLabCostUpdateSchema, livingLabCreateSchema, livingLabUpdateSchema,
} from "@/schemas/living-lab";
import { HERMES_ACTOR, recordAudit } from "@/lib/audit";
import { fromPence, sumPence, toPence } from "@/lib/money";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { DATE_PROP, LIST_SHAPE_PROPS, MAX_BULK_ITEMS, PATCH_NOTE, diffFields, parseFields, pickFields } from "./_shared";

interface CostRecord {
  id: string;
  estBudget: unknown;
  actualSpend: unknown;
  startDate: Date | string | null;
  endDate: Date | string | null;
  [key: string]: unknown;
}

const serializeCost = (c: CostRecord) => ({
  ...c,
  estBudget: Number(c.estBudget),
  actualSpend: Number(c.actualSpend),
  startDate: c.startDate instanceof Date ? c.startDate.toISOString() : c.startDate,
  endDate: c.endDate instanceof Date ? c.endDate.toISOString() : c.endDate,
});

const MIRROR_NOTE =
  "Cost rows with a taskId are mirrors of that task's budget/spend (one per lab) and are rewritten whenever the task is saved; " +
  "only rows with taskId null are standalone lab spend.";

const money = (values: Prisma.Decimal[]): number => Number(fromPence(sumPence(values.map((v) => toPence(v)))));

/**
 * Per-lab totals, split into standalone rows (real lab spend) and task
 * mirrors (the same money as the task, repeated in every lab).
 */
async function labTotals(labIds: string[]) {
  const costs = await prisma.livingLabCost.findMany({
    where: { labId: { in: labIds } },
    select: { labId: true, taskId: true, estBudget: true, actualSpend: true },
  });
  const totals = new Map<string, {
    standalone: { count: number; estBudget: number; actualSpend: number };
    taskMirrored: { count: number; estBudget: number; actualSpend: number };
  }>();
  for (const labId of labIds) {
    const rows = costs.filter((c) => c.labId === labId);
    const standalone = rows.filter((c) => c.taskId === null);
    const mirrored = rows.filter((c) => c.taskId !== null);
    totals.set(labId, {
      standalone: {
        count: standalone.length,
        estBudget: money(standalone.map((c) => c.estBudget)),
        actualSpend: money(standalone.map((c) => c.actualSpend)),
      },
      taskMirrored: {
        count: mirrored.length,
        estBudget: money(mirrored.map((c) => c.estBudget)),
        actualSpend: money(mirrored.map((c) => c.actualSpend)),
      },
    });
  }
  return totals;
}

export function registerLivingLabTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("living_lab_list", defineTool(
    "List living labs. By default every cost row is inlined; `summary: true` returns one row per lab with cost totals " +
      "split into standalone vs task-mirrored (and budgetRemaining = totalBudget − standalone estBudget) instead. " +
      `\`fields\` gives a sparse fieldset. ${MIRROR_NOTE}`,
    { type: "object", properties: { projectId: { type: "string" }, ...LIST_SHAPE_PROPS } },
    async (args) => {
      return tryCatchTool(async () => {
        const where: Prisma.LivingLabWhereInput = args.projectId ? { projectId: String(args.projectId) } : {};
        const fields = parseFields(args);

        if (args.summary === true) {
          const labs = await prisma.livingLab.findMany({ where, orderBy: { name: "asc" } });
          const totals = await labTotals(labs.map((l) => l.id));
          return createToolResponse(labs.map((lab) => {
            const t = totals.get(lab.id)!;
            const totalBudget = Number(lab.totalBudget);
            return pickFields({
              id: lab.id, projectId: lab.projectId, name: lab.name, location: lab.location, totalBudget,
              standalone: t.standalone, taskMirrored: t.taskMirrored,
              budgetRemaining: Number(fromPence(toPence(totalBudget) - toPence(t.standalone.estBudget))),
            }, fields);
          }));
        }

        const labs = await prisma.livingLab.findMany({
          where,
          include: { costs: { include: { owner: { select: { id: true, name: true } } }, orderBy: { startDate: "asc" } } },
          orderBy: { name: "asc" },
        });
        return createToolResponse(labs.map((lab) => pickFields(
          { ...lab, totalBudget: Number(lab.totalBudget), costs: lab.costs.map((c) => serializeCost(c)) },
          fields
        )));
      });
    }
  ));

  handlers.set("living_lab_get", defineTool(
    `Get a single living lab by ID with its costs and standalone/task-mirrored totals. ${MIRROR_NOTE}`,
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const lab = await prisma.livingLab.findUnique({
          where: { id: String(id) },
          include: { costs: { include: { owner: { select: { id: true, name: true } }, costCategory: { select: { id: true, name: true } }, task: { select: { id: true, code: true, title: true } } }, orderBy: { startDate: "asc" } } },
        });
        if (!lab) return createToolResponse({ error: "Living lab not found" });
        const totals = (await labTotals([lab.id])).get(lab.id)!;
        return createToolResponse({ ...lab, totalBudget: Number(lab.totalBudget), totals, costs: lab.costs.map((c) => serializeCost(c)) });
      });
    }
  ));

  handlers.set("living_lab_create", defineTool(
    "Create a living lab",
    {
      type: "object",
      properties: { projectId: { type: "string" }, name: { type: "string" }, location: { type: "string" }, totalBudget: { type: "number" } },
      required: ["projectId", "name"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = livingLabCreateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const lab = await prisma.livingLab.create({
          data: { projectId: data.projectId, name: data.name, location: data.location ?? null, totalBudget: data.totalBudget },
        });
        return createToolResponse({ ...lab, totalBudget: Number(lab.totalBudget) });
      });
    }
  ));

  handlers.set("living_lab_update", defineTool(
    `Update a living lab's name, location or totalBudget. ${PATCH_NOTE} totalBudget changes are audited.`,
    {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, location: { type: ["string", "null"] }, totalBudget: { type: "number" } },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = livingLabUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const result = await prisma.$transaction(async (tx) => {
          const before = await tx.livingLab.findUnique({ where: { id } });
          if (!before) return null;
          const after = await tx.livingLab.update({ where: { id }, data: validation.data });
          const changes = diffFields(before, after);
          if (changes.totalBudget) {
            await recordAudit(tx, {
              actor: HERMES_ACTOR, action: "living_lab.update", entityType: "LivingLab", entityId: id, before, after,
            });
          }
          return { ...after, totalBudget: Number(after.totalBudget), changes };
        });
        if (!result) return createToolResponse({ error: "Living lab not found" });
        return createToolResponse(result);
      });
    }
  ));

  handlers.set("living_lab_delete", defineTool(
    "Delete a living lab and all its cost rows. Refused if the lab has standalone cost rows with actual spend " +
      "(real money would disappear from the books) unless `force: true`. Use `dryRun: true` to see what would be removed.",
    {
      type: "object",
      properties: { id: { type: "string" }, force: { type: "boolean" }, dryRun: { type: "boolean" } },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const lab = await prisma.livingLab.findUnique({ where: { id }, include: { costs: true } });
        if (!lab) return createToolResponse({ error: "Living lab not found" });
        const totals = (await labTotals([id])).get(id)!;
        const summary = { id: lab.id, name: lab.name, totalBudget: Number(lab.totalBudget), ...totals };

        if (args.dryRun === true) return createToolResponse({ dryRun: true, wouldDelete: summary });
        if (totals.standalone.actualSpend > 0 && args.force !== true) {
          return createToolResponse({
            error: `Living lab "${lab.name}" has ${totals.standalone.count} standalone cost row(s) with £${totals.standalone.actualSpend} actual spend. ` +
              "Deleting it removes that spend from the books. Pass force: true to delete anyway.",
            wouldDelete: summary,
          });
        }

        await prisma.$transaction(async (tx) => {
          await tx.livingLab.delete({ where: { id } });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "living_lab.delete", entityType: "LivingLab", entityId: id, before: lab,
          });
        });
        return createToolResponse({ ok: true, deleted: summary });
      });
    }
  ));

  handlers.set("living_lab_cost_list", defineTool(
    `List costs for a specific living lab. ${MIRROR_NOTE}`,
    { type: "object", properties: { labId: { type: "string" }, standaloneOnly: { type: "boolean" }, ...LIST_SHAPE_PROPS }, required: ["labId"] },
    async (args) => {
      return tryCatchTool(async () => {
        const where: Prisma.LivingLabCostWhereInput = { labId: String(args.labId) };
        if (args.standaloneOnly === true) where.taskId = null;
        const costs = await prisma.livingLabCost.findMany({
          where,
          include: { owner: { select: { id: true, name: true } }, costCategory: { select: { id: true, name: true } }, task: { select: { id: true, code: true, title: true } } },
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
        });
        const fields = parseFields(args);
        return createToolResponse(costs.map((c) => {
          if (args.summary !== true) return pickFields(serializeCost(c), fields);
          return pickFields({
            id: c.id, taskId: c.taskId, taskCode: c.task?.code ?? null, costCategory: c.costCategory?.name ?? null,
            estBudget: Number(c.estBudget), actualSpend: Number(c.actualSpend),
            startDate: c.startDate?.toISOString().slice(0, 10) ?? null, notes: c.notes,
          }, fields);
        }));
      });
    }
  ));

  handlers.set("living_lab_cost_create", defineTool(
    "Create a cost item for a living lab. Leave taskId empty for standalone lab spend.",
    {
      type: "object",
      properties: {
        labId: { type: "string" }, taskId: { type: "string" }, milestoneId: { type: "string" },
        costCategoryId: { type: "string" }, ownerId: { type: "string" },
        estBudget: { type: "number" }, actualSpend: { type: "number" },
        startDate: DATE_PROP, endDate: DATE_PROP, notes: { type: "string" },
      },
      required: ["labId"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const labId = String(args.labId);
        const validation = livingLabCostCreateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const lab = await prisma.livingLab.findUnique({ where: { id: labId } });
        if (!lab) return createToolResponse({ error: "Living lab not found" });
        const data = validation.data;
        const cost = await prisma.livingLabCost.create({
          // taskId/milestoneId used to be written as "" when omitted, which no
          // task matches — so a standalone cost could not be created at all.
          data: { labId, costCategoryId: data.costCategoryId ?? null, ownerId: data.ownerId ?? null, taskId: data.taskId ?? null, milestoneId: data.milestoneId ?? null, estBudget: data.estBudget, actualSpend: data.actualSpend, startDate: data.startDate ?? null, endDate: data.endDate ?? null, notes: data.notes ?? null },
          include: { owner: { select: { id: true, name: true } }, costCategory: { select: { name: true } } },
        });
        return createToolResponse(serializeCost(cost));
      });
    }
  ));

  handlers.set("living_lab_cost_update", defineTool(
    `Update a living lab cost item. ${PATCH_NOTE} Editing a task-mirrored row (taskId set) is overwritten the next time that task is saved — edit the task instead.`,
    {
      type: "object",
      properties: {
        id: { type: "string" }, costCategoryId: { type: ["string", "null"] }, ownerId: { type: ["string", "null"] },
        estBudget: { type: "number" }, actualSpend: { type: "number" },
        startDate: DATE_PROP, endDate: DATE_PROP, notes: { type: ["string", "null"] },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = livingLabCostUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const before = await prisma.livingLabCost.findUnique({ where: { id } });
        if (!before) return createToolResponse({ error: "Cost not found" });
        const cost = await prisma.livingLabCost.update({
          where: { id },
          data: validation.data,
          include: { owner: { select: { id: true, name: true } }, costCategory: { select: { name: true } } },
        });
        return createToolResponse({
          ...serializeCost(cost),
          changes: diffFields(before, cost),
          ...(cost.taskId ? { warning: "This row mirrors a task; the next save of that task will overwrite estBudget/actualSpend here." } : {}),
        });
      });
    }
  ));

  handlers.set("living_lab_cost_delete", defineTool(
    "Delete a living lab cost item",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const cost = await prisma.livingLabCost.findUnique({ where: { id: String(id) } });
        if (!cost) return createToolResponse({ error: "Cost not found" });
        await prisma.livingLabCost.delete({ where: { id: cost.id } });
        return createToolResponse({ ok: true, deleted: serializeCost(cost) });
      });
    }
  ));

  handlers.set("living_lab_cost_bulk_delete", defineTool(
    `Delete many living lab cost rows in one atomic call (max ${MAX_BULK_ITEMS}). Pass \`ids\`, or \`dedupeLabId\` to remove ` +
      "exact duplicates in that lab (task mirrors: more than one row per task; standalone: identical category/owner/amounts/dates/notes), " +
      "keeping one of each. Use `dryRun: true` to list what would go. Returns the deleted rows and their totals.",
    {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        dedupeLabId: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
    async (args) => {
      return tryCatchTool(async () => {
        let targets: Prisma.LivingLabCostGetPayload<object>[];
        if (Array.isArray(args.ids)) {
          const ids = [...new Set((args.ids as unknown[]).map(String))];
          if (ids.length > MAX_BULK_ITEMS) return createToolResponse({ error: `Too many ids (${ids.length}); max ${MAX_BULK_ITEMS} per call` });
          targets = await prisma.livingLabCost.findMany({ where: { id: { in: ids } } });
          const found = new Set(targets.map((t) => t.id));
          const missing = ids.filter((i) => !found.has(i));
          if (missing.length > 0) return createToolResponse({ error: "Some ids were not found; nothing was deleted", missing });
        } else if (args.dedupeLabId) {
          const rows = await prisma.livingLabCost.findMany({ where: { labId: String(args.dedupeLabId) }, orderBy: { id: "asc" } });
          const seen = new Set<string>();
          targets = [];
          for (const r of rows) {
            const key = r.taskId
              ? `task:${r.taskId}`
              : JSON.stringify([r.costCategoryId, r.ownerId, r.milestoneId, r.estBudget.toString(), r.actualSpend.toString(),
                  r.startDate?.toISOString() ?? null, r.endDate?.toISOString() ?? null, r.notes ?? null]);
            if (seen.has(key)) targets.push(r);
            else seen.add(key);
          }
          if (targets.length > MAX_BULK_ITEMS) targets = targets.slice(0, MAX_BULK_ITEMS);
        } else {
          return createToolResponse({ error: "Provide `ids` or `dedupeLabId`" });
        }

        const deleted = targets.map((c) => ({
          id: c.id, labId: c.labId, taskId: c.taskId,
          estBudget: Number(c.estBudget), actualSpend: Number(c.actualSpend),
          startDate: c.startDate?.toISOString().slice(0, 10) ?? null, notes: c.notes,
        }));
        const totals = {
          count: targets.length,
          estBudget: money(targets.map((c) => c.estBudget)),
          actualSpend: money(targets.map((c) => c.actualSpend)),
          standaloneActualSpend: money(targets.filter((c) => c.taskId === null).map((c) => c.actualSpend)),
        };
        if (args.dryRun === true) return createToolResponse({ dryRun: true, wouldDelete: deleted, totals });
        if (targets.length > 0) {
          await prisma.livingLabCost.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } });
        }
        return createToolResponse({ ok: true, deleted, totals });
      });
    }
  ));
}
