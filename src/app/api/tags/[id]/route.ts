import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { tagUpdateSchema } from "@/schemas/tag";

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "tag", id, "project:structure");
  try {
    await prisma.tag.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true });
});

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "tag", id, "project:structure");
  const validation = tagUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json({ error: "Invalid request data", details: validation.error.flatten() }, { status: 400 });
  }
  try {
    const tag = await prisma.tag.update({ where: { id }, data: validation.data });
    return NextResponse.json(tag);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return NextResponse.json({ error: "Tag not found" }, { status: 404 });
      if (error.code === "P2002") {
        return NextResponse.json({ error: "A tag with this name already exists in this project" }, { status: 409 });
      }
    }
    throw error;
  }
});
