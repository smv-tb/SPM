export const dynamic = "force-dynamic";
import { requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { tagCreateSchema } from "@/schemas/tag";
import { Prisma } from "@prisma/client";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  await requireProjectAccess(session, projectId);

  const tags = await prisma.tag.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(tags);
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const validation = tagCreateSchema.safeParse(await req.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json({ error: "Invalid request data", details: validation.error.flatten() }, { status: 400 });
  }
  const { projectId, name, color } = validation.data;
  await requireProjectAccess(session, projectId, "project:structure");

  try {
    const tag = await prisma.tag.create({ data: { projectId, name, color: color ?? "#6366f1" } });
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A tag with this name already exists in this project" }, { status: 409 });
    }
    throw error;
  }
});
