export const dynamic = "force-dynamic";

import { requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, CustomFieldModule } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { customFieldBulkValuesSchema } from "@/schemas/custom-field";
import { parseCustomFieldValue } from "@/lib/custom-fields";
import { projectFilterForRequest } from "@/lib/current-project";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const entityId = url.searchParams.get("entityId");
  const moduleParam = url.searchParams.get("module");

  // Every value of one record type in a project, for the list screens' columns.
  if (!entityId && moduleParam) {
    if (!(moduleParam in CustomFieldModule)) {
      return NextResponse.json({ error: "Invalid module" }, { status: 400 });
    }
    // An explicit ?projectId= is checked against the user's active projects.
    const rows = await prisma.customFieldValue.findMany({
      where: {
        definition: {
          ...(await projectFilterForRequest(session.user!.id!, req)),
          module: moduleParam as CustomFieldModule,
        },
      },
      include: { definition: { select: { fieldType: true } } },
    });
    return NextResponse.json(
      rows.map((v) => ({
        entityId: v.entityId,
        definitionId: v.definitionId,
        value: parseCustomFieldValue(v.definition.fieldType, v),
      }))
    );
  }

  if (!entityId) {
    return NextResponse.json({ error: "entityId is required" }, { status: 400 });
  }

  const values = await prisma.customFieldValue.findMany({
    where: { entityId },
    include: {
      definition: {
        select: {
          id: true,
          name: true,
          fieldType: true,
          module: true,
          options: true,
          required: true,
        },
      },
    },
  });

  const hydrated = values.map((v) => {
    let displayValue: unknown = null;
    switch (v.definition.fieldType) {
      case "TEXT":
      case "SELECT":
        displayValue = v.valueString;
        break;
      case "NUMBER":
        displayValue =
          v.valueNumber === null || v.valueNumber === undefined
            ? null
            : typeof (v.valueNumber as { toNumber?: () => number }).toNumber === "function"
              ? (v.valueNumber as { toNumber: () => number }).toNumber()
              : Number(v.valueNumber);
        break;
      case "DATE":
        displayValue = v.valueDate;
        break;
      case "BOOLEAN":
        displayValue = v.valueBoolean;
        break;
      case "MULTI_SELECT":
        displayValue = v.valueJson;
        break;
      default:
        displayValue = v.valueString ?? v.valueJson;
    }

    return {
      id: v.id,
      definitionId: v.definitionId,
      entityId: v.entityId,
      fieldName: v.definition.name,
      fieldType: v.definition.fieldType,
      module: v.definition.module,
      options: v.definition.options,
      required: v.definition.required,
      value: displayValue,
      raw: {
        valueString: v.valueString,
        valueNumber: v.valueNumber,
        valueDate: v.valueDate,
        valueBoolean: v.valueBoolean,
        valueJson: v.valueJson,
      },
    };
  });

  return NextResponse.json(hydrated);
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = customFieldBulkValuesSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const { entityId, values } = validation.data;

  const url = req.nextUrl;
  const projectId = url.searchParams.get("projectId");

  // Collect definition IDs
  const definitionIds = [...new Set(values.map((v) => v.definitionId))];

  // Validate definitions exist and belong to the same project
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { id: { in: definitionIds } },
    select: { id: true, projectId: true, fieldType: true },
  });

  if (definitions.length !== definitionIds.length) {
    return NextResponse.json({ error: "One or more definitions not found" }, { status: 404 });
  }

  const defProjectIds = new Set(definitions.map((d) => d.projectId));
  if (defProjectIds.size !== 1) {
    return NextResponse.json(
      { error: "All definitions must belong to the same project" },
      { status: 400 }
    );
  }

  for (const definitionProject of defProjectIds) await requireProjectAccess(session, definitionProject, "work:edit");

  if (projectId && !defProjectIds.has(projectId)) {
    return NextResponse.json(
      { error: "Definitions do not belong to the specified project" },
      { status: 403 }
    );
  }

  // Build upsert operations
  const operations = values.map((val) => {
    const data: Prisma.CustomFieldValueUncheckedCreateInput = {
      definitionId: val.definitionId,
      entityId,
      valueString: val.valueString ?? null,
      valueNumber: val.valueNumber ?? null,
      valueDate: val.valueDate ?? null,
      valueBoolean: val.valueBoolean ?? null,
      valueJson: val.valueJson ?? null,
    };

    return prisma.customFieldValue.upsert({
      where: {
        definitionId_entityId: {
          definitionId: val.definitionId,
          entityId,
        },
      },
      update: data,
      create: data,
    });
  });

  try {
    const results = await prisma.$transaction(operations);
    return NextResponse.json(results, { status: 201 });
  } catch (error) {
    // Anything else (including an archived project) is the shared handler's to log and answer.
    throw error;
  }
});
