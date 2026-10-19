export const dynamic = "force-dynamic";

import { requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { customFieldDefinitionSchema } from "@/schemas/custom-field";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const projectId = url.searchParams.get("projectId");
  const moduleParam = url.searchParams.get("module");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  await requireProjectAccess(session, projectId);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const definitions = await prisma.customFieldDefinition.findMany({
    where: {
      projectId,
      ...(moduleParam ? { module: moduleParam as import("@prisma/client").CustomFieldModule } : {}),
    },
    orderBy: { orderIndex: "asc" },
  });

  return NextResponse.json(definitions);
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = customFieldDefinitionSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  await requireProjectAccess(session, data.projectId, "project:structure");
  const project = await prisma.project.findUnique({ where: { id: data.projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const definition = await prisma.customFieldDefinition.create({
      data: {
        projectId: data.projectId,
        module: data.module,
        name: data.name,
        fieldType: data.fieldType,
        options: data.options as unknown as Prisma.InputJsonValue | undefined,
        required: data.required,
        defaultValue: data.defaultValue ?? null,
        orderIndex: data.orderIndex,
      },
    });
    return NextResponse.json(definition, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A custom field with this name already exists for this module" },
          { status: 409 }
        );
      }
    }
    // Anything else (including an archived project) is the shared handler's to log and answer.
    throw error;
  }
});
