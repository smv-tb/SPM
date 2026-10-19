import { prisma } from "@/lib/prisma";
import { CustomFieldModule } from "@prisma/client";

export function parseCustomFieldValue(
  fieldType: string,
  value: {
    valueString: string | null;
    valueNumber: unknown;
    valueDate: Date | null;
    valueBoolean: boolean | null;
    valueJson: unknown;
  }
): unknown {
  switch (fieldType) {
    case "TEXT":
    case "SELECT":
      return value.valueString ?? null;
    case "NUMBER": {
      if (value.valueNumber === null || value.valueNumber === undefined) return null;
      const num =
        typeof (value.valueNumber as { toNumber?: () => number }).toNumber === "function"
          ? (value.valueNumber as { toNumber: () => number }).toNumber()
          : Number(value.valueNumber);
      return Number.isFinite(num) ? num : null;
    }
    case "DATE":
      return value.valueDate ?? null;
    case "BOOLEAN":
      return value.valueBoolean ?? null;
    case "MULTI_SELECT":
      return value.valueJson ?? null;
    default:
      return value.valueString ?? value.valueJson ?? null;
  }
}

export async function getEntityCustomFields(
  projectId: string,
  module: CustomFieldModule,
  entityId: string
): Promise<Record<string, unknown>> {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { projectId, module },
    orderBy: { orderIndex: "asc" },
    include: {
      values: {
        where: { entityId },
        take: 1,
      },
    },
  });

  const result: Record<string, unknown> = {};
  for (const def of definitions) {
    const val = def.values[0];
    result[def.name] = val
      ? parseCustomFieldValue(def.fieldType, val)
      : def.defaultValue ?? null;
  }
  return result;
}

export async function attachCustomFields<T extends { id: string }>(
  projectId: string,
  module: CustomFieldModule,
  entities: T[]
): Promise<void> {
  if (entities.length === 0) return;

  const entityIds = entities.map((e) => e.id);

  const definitions = await prisma.customFieldDefinition.findMany({
    where: { projectId, module },
    orderBy: { orderIndex: "asc" },
    include: {
      values: {
        where: { entityId: { in: entityIds } },
      },
    },
  });

  const valuesByEntity = new Map<string, Record<string, unknown>>();
  for (const entity of entities) {
    valuesByEntity.set(entity.id, {});
  }

  for (const def of definitions) {
    const valueMap = new Map<string, typeof def.values[0]>();
    for (const v of def.values) {
      valueMap.set(v.entityId, v);
    }

    for (const entity of entities) {
      const val = valueMap.get(entity.id);
      const parsed = val
        ? parseCustomFieldValue(def.fieldType, val)
        : def.defaultValue ?? null;
      valuesByEntity.get(entity.id)![def.name] = parsed;
    }
  }

  for (const entity of entities) {
    (entity as unknown as Record<string, unknown>).customFields = valuesByEntity.get(entity.id) ?? {};
  }
}
