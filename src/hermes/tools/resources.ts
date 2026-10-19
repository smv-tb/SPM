import { prisma } from "@/lib/prisma";
import { resourceSchema, resourceUpdateSchema } from "@/schemas/resource";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { parsePagination, paginateResponse, PATCH_NOTE, diffFields, diffIdSet } from "./_shared";

const includes = {
  resourceMilestones: { include: { milestone: { select: { id: true, code: true, title: true } } } },
  resourceTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
  user: { select: { id: true, name: true, email: true } },
} as const;

export function registerResourceTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("resource_list", defineTool(
    "List resources with cursor-based pagination",
    { type: "object", properties: { cursor: { type: "string" }, limit: { type: "number" }, status: { type: "string" }, type: { type: "string" }, projectId: { type: "string" } } },
    async (args) => {
      return tryCatchTool(async () => {
        const { take, cursor, skip } = parsePagination(args);
        const where: Record<string, unknown> = {};
        if (args.status) where.status = String(args.status);
        if (args.projectId) where.projectId = String(args.projectId);
        if (args.type) where.type = String(args.type);
        const resources = await prisma.resource.findMany({ where, include: includes, orderBy: { name: "asc" }, take, cursor, skip });
        return createToolResponse(paginateResponse(resources, take - 1));
      });
    }
  ));

  handlers.set("resource_get", defineTool(
    "Get a single resource by ID",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const resource = await prisma.resource.findUnique({ where: { id: String(id) }, include: { ...includes, project: { select: { id: true, name: true } } } });
        if (!resource) return createToolResponse({ error: "Resource not found" });
        return createToolResponse(resource);
      });
    }
  ));

  handlers.set("resource_create", defineTool(
    "Create a new resource",
    {
      type: "object",
      properties: {
        name: { type: "string" }, role: { type: "string" }, projectId: { type: "string" },
        department: { type: "string" }, type: { type: "string" },
        dayRate: { type: "number" }, daysPerMonth: { type: "number" },
        yearlyCost: { type: "number" }, status: { type: "string" }, notes: { type: "string" },
        userId: { type: "string" },
        tagIds: { type: "array", items: { type: "string" } },
        milestoneIds: { type: "array", items: { type: "string" } },
      },
      required: ["name", "role", "projectId"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = resourceSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const resource = await prisma.$transaction(async (tx) => {
          const r = await tx.resource.create({ data: { name: data.name, role: data.role, projectId: data.projectId, department: data.department ?? null, type: data.type, tagFocus: null, availability: null, dayRate: data.dayRate ?? null, daysPerMonth: data.daysPerMonth ?? null, yearlyCost: data.yearlyCost ?? null, status: data.status, notes: data.notes ?? null, userId: data.userId ?? null } });
          if (data.tagIds?.length) await tx.resourceTag.createMany({ data: data.tagIds.map((tid) => ({ resourceId: r.id, tagId: tid })) });
          if (data.milestoneIds?.length) await tx.resourceMilestone.createMany({ data: data.milestoneIds.map((mid) => ({ resourceId: r.id, milestoneId: mid })) });
          return r;
        });
        const created = await prisma.resource.findUnique({ where: { id: resource.id }, include: includes });
        return createToolResponse(created);
      });
    }
  ));

  handlers.set("resource_update", defineTool(
    `Update an existing resource. ${PATCH_NOTE} tagIds/milestoneIds replace the full set when given.`,
    {
      type: "object",
      properties: {
        id: { type: "string" }, name: { type: "string" }, role: { type: "string" },
        department: { type: "string" }, type: { type: "string" },
        dayRate: { type: "number" }, daysPerMonth: { type: "number" },
        yearlyCost: { type: "number" }, status: { type: "string" }, notes: { type: "string" },
        userId: { type: "string" },
        tagIds: { type: "array", items: { type: "string" } },
        milestoneIds: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = resourceUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const existing = await prisma.resource.findUnique({ where: { id }, include: includes });
        if (!existing) return createToolResponse({ error: "Resource not found" });
        const data = validation.data;
        const { tagIds, milestoneIds, ...updateFields } = data;
        await prisma.$transaction(async (tx) => {
          await tx.resource.update({ where: { id }, data: updateFields });
          if (milestoneIds !== undefined) {
            await tx.resourceMilestone.deleteMany({ where: { resourceId: id } });
            if (milestoneIds.length > 0) await tx.resourceMilestone.createMany({ data: milestoneIds.map((mid: string) => ({ resourceId: id, milestoneId: mid })) });
          }
          if (tagIds !== undefined) {
            await tx.resourceTag.deleteMany({ where: { resourceId: id } });
            if (tagIds.length > 0) await tx.resourceTag.createMany({ data: tagIds.map((tid: string) => ({ resourceId: id, tagId: tid })) });
          }
        });
        const result = await prisma.resource.findUniqueOrThrow({ where: { id }, include: includes });
        const changes = diffFields(existing, result);
        diffIdSet(changes, "tagIds", existing.resourceTags.map((t) => t.tagId), tagIds);
        diffIdSet(changes, "milestoneIds", existing.resourceMilestones.map((m) => m.milestoneId), milestoneIds);
        return createToolResponse({ ...result, changes });
      });
    }
  ));

  handlers.set("resource_delete", defineTool(
    "Delete a resource. Blocks if it has milestone assignments.",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const uid = String(id);
        const resource = await prisma.resource.findUnique({ where: { id: uid }, include: { resourceMilestones: true, tasks: { select: { id: true } } } });
        if (!resource) return createToolResponse({ error: "Resource not found" });
        if (resource.resourceMilestones.length > 0) return createToolResponse({ error: "Cannot delete resource with milestone assignments" });
        await prisma.resource.delete({ where: { id: uid } });
        return createToolResponse({ ok: true });
      });
    }
  ));
}
