export const dynamic = "force-dynamic";

import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { customFieldValueSchema } from "@/schemas/custom-field";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "customFieldValue", id, "work:edit");
  const body = await req.json();

  const validation = customFieldValueSchema.partial().safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  const updateData: Record<string, unknown> = {};
  if (data.valueString !== undefined) updateData.valueString = data.valueString;
  if (data.valueNumber !== undefined) updateData.valueNumber = data.valueNumber;
  if (data.valueDate !== undefined) updateData.valueDate = data.valueDate;
  if (data.valueBoolean !== undefined) updateData.valueBoolean = data.valueBoolean;
  if (data.valueJson !== undefined) updateData.valueJson = data.valueJson;

  try {
    const value = await prisma.customFieldValue.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(value);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Value not found" }, { status: 404 });
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
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "customFieldValue", id, "work:edit");

  try {
    await prisma.customFieldValue.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Value not found" }, { status: 404 });
      }
    }
    // Anything else (including an archived project) is the shared handler's to log and answer.
    throw error;
  }
});
