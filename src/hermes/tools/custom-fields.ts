import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { customFieldDefinitionSchema, customFieldDefinitionUpdateSchema, customFieldBulkValuesSchema } from "@/schemas/custom-field";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { PATCH_NOTE, diffFields } from "./_shared";

export function registerCustomFieldTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("custom_field_definition_list", defineTool(
    "List custom field definitions for a project and optional module",
    { type: "object", properties: { projectId: { type: "string" }, module: { type: "string" } }, required: ["projectId"] },
    async (args) => {
      return tryCatchTool(async () => {
        const where: Record<string, unknown> = { projectId: String(args.projectId) };
        if (args.module) where.module = String(args.module);
        const definitions = await prisma.customFieldDefinition.findMany({ where, orderBy: { orderIndex: "asc" } });
        return createToolResponse(definitions);
      });
    }
  ));

  handlers.set("custom_field_definition_get", defineTool(
    "Get a single custom field definition by ID",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const def = await prisma.customFieldDefinition.findUnique({ where: { id: String(id) } });
        if (!def) return createToolResponse({ error: "Definition not found" });
        return createToolResponse(def);
      });
    }
  ));

  handlers.set("custom_field_definition_create", defineTool(
    "Create a new custom field definition",
    {
      type: "object",
      properties: {
        projectId: { type: "string" }, module: { type: "string" }, name: { type: "string" },
        fieldType: { type: "string" }, options: { type: "object" },
        required: { type: "boolean" }, defaultValue: { type: "string" }, orderIndex: { type: "number" },
      },
      required: ["projectId", "module", "name", "fieldType"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = customFieldDefinitionSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const project = await prisma.project.findUnique({ where: { id: data.projectId } });
        if (!project) return createToolResponse({ error: "Project not found" });
        const definition = await prisma.customFieldDefinition.create({
          data: { projectId: data.projectId, module: data.module, name: data.name, fieldType: data.fieldType, options: data.options as Prisma.InputJsonValue ?? undefined, required: data.required, defaultValue: data.defaultValue ?? null, orderIndex: data.orderIndex },
        });
        return createToolResponse(definition);
      });
    }
  ));

  handlers.set("custom_field_definition_update", defineTool(
    `Update a custom field definition (cannot change projectId or module). ${PATCH_NOTE}`,
    {
      type: "object",
      properties: {
        id: { type: "string" }, name: { type: "string" }, fieldType: { type: "string" },
        options: { type: "object" }, required: { type: "boolean" },
        defaultValue: { type: "string" }, orderIndex: { type: "number" },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = customFieldDefinitionUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const updateData: Record<string, unknown> = {};
        if (data.name !== undefined) updateData.name = data.name;
        if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
        if (data.options !== undefined) updateData.options = data.options;
        if (data.required !== undefined) updateData.required = data.required;
        if (data.defaultValue !== undefined) updateData.defaultValue = data.defaultValue;
        if (data.orderIndex !== undefined) updateData.orderIndex = data.orderIndex;
        const before = await prisma.customFieldDefinition.findUnique({ where: { id } });
        if (!before) return createToolResponse({ error: "Definition not found" });
        const definition = await prisma.customFieldDefinition.update({ where: { id }, data: updateData });
        return createToolResponse({ ...definition, changes: diffFields(before, definition) });
      });
    }
  ));

  handlers.set("custom_field_definition_delete", defineTool(
    "Delete a custom field definition (cascades to values)",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        await prisma.customFieldDefinition.delete({ where: { id: String(id) } });
        return createToolResponse({ ok: true });
      });
    }
  ));

  handlers.set("custom_field_value_set", defineTool(
    "Upsert custom field values for an entity in bulk",
    {
      type: "object",
      properties: {
        entityId: { type: "string" },
        values: { type: "array", items: { type: "object", properties: { definitionId: { type: "string" }, valueString: { type: "string" }, valueNumber: { type: "number" }, valueDate: { type: "string" }, valueBoolean: { type: "boolean" }, valueJson: { type: "object" } }, required: ["definitionId"] } },
      },
      required: ["entityId", "values"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = customFieldBulkValuesSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const { entityId, values } = validation.data;
        const defIds = [...new Set(values.map((v) => v.definitionId))];
        const definitions = await prisma.customFieldDefinition.findMany({ where: { id: { in: defIds } }, select: { id: true } });
        if (definitions.length !== defIds.length) return createToolResponse({ error: "One or more definitions not found" });
        const operations = values.map((val) => prisma.customFieldValue.upsert({
          where: { definitionId_entityId: { definitionId: val.definitionId, entityId } },
          update: { valueString: val.valueString ?? null, valueNumber: val.valueNumber ?? null, valueDate: val.valueDate ?? null, valueBoolean: val.valueBoolean ?? null, valueJson: val.valueJson ?? null },
          create: { definitionId: val.definitionId, entityId, valueString: val.valueString ?? null, valueNumber: val.valueNumber ?? null, valueDate: val.valueDate ?? null, valueBoolean: val.valueBoolean ?? null, valueJson: val.valueJson ?? null },
        }));
        const results = await prisma.$transaction(operations);
        return createToolResponse(results);
      });
    }
  ));

  handlers.set("custom_field_value_list", defineTool(
    "Get all custom field values for an entity",
    { type: "object", properties: { entityId: { type: "string" } }, required: ["entityId"] },
    async ({ entityId }) => {
      return tryCatchTool(async () => {
        const values = await prisma.customFieldValue.findMany({
          where: { entityId: String(entityId) },
          include: { definition: { select: { id: true, name: true, fieldType: true, module: true, options: true, required: true } } },
        });
        return createToolResponse(values);
      });
    }
  ));

  handlers.set("custom_field_value_delete", defineTool(
    "Delete a custom field value by its ID",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        await prisma.customFieldValue.delete({ where: { id: String(id) } });
        return createToolResponse({ ok: true });
      });
    }
  ));
}
