import { prisma } from "@/lib/prisma";
import { costCategorySchema, costCategoryUpdateSchema } from "@/schemas/cost-category";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { diffFields } from "./_shared";

export function registerCostCategoryTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("cost_category_list", defineTool(
    "List all cost categories",
    { type: "object", properties: {} },
    async () => {
      return tryCatchTool(async () => {
        const categories = await prisma.costCategory.findMany({ orderBy: { name: "asc" } });
        return createToolResponse(categories);
      });
    }
  ));

  handlers.set("cost_category_get", defineTool(
    "Get a single cost category by ID",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const category = await prisma.costCategory.findUnique({ where: { id: String(id) } });
        if (!category) return createToolResponse({ error: "Cost category not found" });
        return createToolResponse(category);
      });
    }
  ));

  handlers.set("cost_category_create", defineTool(
    "Create a new cost category",
    { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = costCategorySchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const category = await prisma.costCategory.create({ data: { name: validation.data.name } });
        return createToolResponse(category);
      });
    }
  ));

  handlers.set("cost_category_update", defineTool(
    "Update a cost category",
    { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id"] },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = costCategoryUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const before = await prisma.costCategory.findUnique({ where: { id: String(args.id) } });
        if (!before) return createToolResponse({ error: "Cost category not found" });
        const category = await prisma.costCategory.update({ where: { id: before.id }, data: validation.data });
        return createToolResponse({ ...category, changes: diffFields(before, category) });
      });
    }
  ));

  handlers.set("cost_category_delete", defineTool(
    "Delete a cost category",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        await prisma.costCategory.delete({ where: { id: String(id) } });
        return createToolResponse({ ok: true });
      });
    }
  ));
}
