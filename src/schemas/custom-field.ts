import { z } from "zod";
import { partialUpdate } from "./_helpers";

export const CustomFieldModuleEnum = z.enum([
  "PROJECT",
  "PHASE",
  "MILESTONE",
  "TASK",
  "RESOURCE",
  "FUNDING_RECORD",
  "LIVING_LAB",
]);

export const CustomFieldTypeEnum = z.enum([
  "TEXT",
  "NUMBER",
  "DATE",
  "SELECT",
  "MULTI_SELECT",
  "BOOLEAN",
]);

export const customFieldDefinitionSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  module: CustomFieldModuleEnum,
  name: z.string().min(1, "Name is required").max(255),
  fieldType: CustomFieldTypeEnum,
  options: z.record(z.string(), z.any()).nullable().optional(),
  required: z.boolean().default(false),
  defaultValue: z.string().nullable().optional(),
  orderIndex: z.coerce.number().int().default(0),
});

export const customFieldDefinitionUpdateSchema = partialUpdate(customFieldDefinitionSchema)
  .omit({ projectId: true, module: true });

export const customFieldValueSchema = z.object({
  definitionId: z.string().uuid("Invalid definition ID"),
  // Not .uuid(): funding records seeded from the ODS workbook have composite IDs.
  entityId: z.string().min(1, "Invalid entity ID"),
  valueString: z.string().nullable().optional(),
  valueNumber: z.coerce.number().nullable().optional(),
  valueDate: z.coerce.date().nullable().optional(),
  valueBoolean: z.boolean().nullable().optional(),
  valueJson: z.any().nullable().optional(),
});

export const customFieldBulkValuesSchema = z.object({
  // Not .uuid(): funding records seeded from the ODS workbook have composite IDs.
  entityId: z.string().min(1, "Invalid entity ID"),
  values: z.array(customFieldValueSchema.omit({ entityId: true })).min(1, "At least one value is required"),
});

export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionSchema>;
export type CustomFieldDefinitionUpdateInput = z.infer<typeof customFieldDefinitionUpdateSchema>;
export type CustomFieldValueInput = z.infer<typeof customFieldValueSchema>;
export type CustomFieldBulkValuesInput = z.infer<typeof customFieldBulkValuesSchema>;
