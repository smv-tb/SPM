export const dynamic = "force-dynamic";

import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { customFieldDefinitionUpdateSchema } from "@/schemas/custom-field";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "customFieldDefinition", id, "project:structure");
  const body = await req.json();

  const validation = customFieldDefinitionUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  // Reject attempts to change projectId or module
  if (body.projectId !== undefined || body.module !== undefined) {
    return NextResponse.json(
      { error: "projectId and module cannot be changed" },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
  if (data.options !== undefined) updateData.options = data.options;
  if (data.required !== undefined) updateData.required = data.required;
  if (data.defaultValue !== undefined) updateData.defaultValue = data.defaultValue;
  if (data.orderIndex !== undefined) updateData.orderIndex = data.orderIndex;

  try {
    const definition = await prisma.customFieldDefinition.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(definition);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A custom field with this name already exists for this module" },
          { status: 409 }
        );
      }
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Definition not found" }, { status: 404 });
      }
    }
    // Anything else (including an archived project) is the shared handler's to log and answer.
    throw error;
  }
});

export const DELETE = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "customFieldDefinition", id, "project:structure");

  try {
    await prisma.customFieldDefinition.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Definition not found" }, { status: 404 });
      }
    }
    // Anything else (including an archived project) is the shared handler's to log and answer.
    throw error;
  }
});
