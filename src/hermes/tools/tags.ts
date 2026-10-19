import { prisma } from "@/lib/prisma";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { diffFields } from "./_shared";

export function registerTagTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("tag_list", defineTool(
    "List all tags for a project",
    { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    async ({ projectId }) => {
      return tryCatchTool(async () => {
        const tags = await prisma.tag.findMany({ where: { projectId: String(projectId) }, orderBy: { name: "asc" } });
        return createToolResponse(tags);
      });
    }
  ));

  handlers.set("tag_get", defineTool(
    "Get a single tag by ID",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const tag = await prisma.tag.findUnique({ where: { id: String(id) } });
        if (!tag) return createToolResponse({ error: "Tag not found" });
        return createToolResponse(tag);
      });
    }
  ));

  handlers.set("tag_create", defineTool(
    "Create a new tag for a project",
    { type: "object", properties: { projectId: { type: "string" }, name: { type: "string" }, color: { type: "string" } }, required: ["projectId", "name"] },
    async (args) => {
      return tryCatchTool(async () => {
        const tag = await prisma.tag.create({ data: { projectId: String(args.projectId), name: String(args.name).trim(), color: String(args.color ?? "#6366f1") } });
        return createToolResponse(tag);
      });
    }
  ));

  handlers.set("tag_update", defineTool(
    "Update a tag's name or color",
    { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, color: { type: "string" } }, required: ["id"] },
    async (args) => {
      return tryCatchTool(async () => {
        const data: Record<string, unknown> = {};
        if (args.name !== undefined) data.name = String(args.name);
        if (args.color !== undefined) data.color = String(args.color);
        const before = await prisma.tag.findUnique({ where: { id: String(args.id) } });
        if (!before) return createToolResponse({ error: "Tag not found" });
        const tag = await prisma.tag.update({ where: { id: before.id }, data });
        return createToolResponse({ ...tag, changes: diffFields(before, tag) });
      });
    }
  ));

  handlers.set("tag_delete", defineTool(
    "Delete a tag",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        await prisma.tag.delete({ where: { id: String(id) } });
        return createToolResponse({ ok: true });
      });
    }
  ));
}
