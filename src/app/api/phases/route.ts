import { requireEntityAccess, requireProjectAccess } from "@/lib/project-access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { phaseCreateSchema, phaseUpdateSchema } from "@/schemas/phase";
import { z } from "zod";

export const GET = withErrorHandler(async (req: Request) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  await requireProjectAccess(session, projectId);

  const phases = await prisma.phase.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
  });
  return NextResponse.json(phases);
});

export const POST = withErrorHandler(async (req: Request) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = phaseCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;
  await requireProjectAccess(session, data.projectId, "project:structure");
  const maxOrderPhase = await prisma.phase.findFirst({
    where: { projectId: data.projectId },
    orderBy: { orderIndex: "desc" },
    select: { orderIndex: true },
  });

  const nextOrderIndex = (maxOrderPhase?.orderIndex ?? -1) + 1;

  const newPhase = await prisma.phase.create({
    data: {
      projectId: data.projectId,
      name: data.name,
      color: data.color,
      orderIndex: nextOrderIndex,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
    },
  });

  return NextResponse.json(newPhase);
});

export const PATCH = withErrorHandler(async (req: Request) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  // Validate id separately — it's required for update but not part of phaseUpdateSchema
  const idSchema = z.string().uuid("Invalid phase ID");
  const idResult = idSchema.safeParse(body.id);
  if (!idResult.success) {
    return NextResponse.json(
      { error: "id is required and must be a valid UUID", details: idResult.error.flatten() },
      { status: 400 }
    );
  }
  const id = idResult.data;
  await requireEntityAccess(session, "phase", id, "project:structure");

  const validation = phaseUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;
  const { ...updateData } = data;
  const updatedPhase = await prisma.phase.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(updatedPhase);
});

export const DELETE = withErrorHandler(async (req: Request) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  await requireEntityAccess(session, "phase", id, "project:structure");

  await prisma.phase.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
});
