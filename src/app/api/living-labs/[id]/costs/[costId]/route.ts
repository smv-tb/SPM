export const dynamic = "force-dynamic";
import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { livingLabCostUpdateSchema } from "@/schemas/living-lab";

type RouteContext = { params: Promise<{ id: string; costId: string }> };

export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { costId } = await params;

  await requireEntityAccess(session, "livingLabCost", costId, "work:edit");
  const body = await req.json();

  const validation = livingLabCostUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  const cost = await prisma.livingLabCost.update({
    where: { id: costId },
    data: {
      costCategoryId: data.costCategoryId,
      ownerId: data.ownerId,
      estBudget: data.estBudget,
      actualSpend: data.actualSpend,
      startDate: data.startDate,
      endDate: data.endDate,
      notes: data.notes,
    },
    include: {
      owner: { select: { id: true, name: true } },
      costCategory: { select: { name: true } },
    },
  });

  return NextResponse.json({
    ...cost,
    estBudget: Number(cost.estBudget),
    actualSpend: Number(cost.actualSpend),
    startDate: cost.startDate?.toISOString() ?? null,
    endDate: cost.endDate?.toISOString() ?? null,
    notes: cost.notes,
    categoryName: cost.costCategory?.name ?? null,
  });
});

export const DELETE = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { costId } = await params;

  await requireEntityAccess(session, "livingLabCost", costId, "work:edit");
  try {
    await prisma.livingLabCost.delete({ where: { id: costId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Cost not found" }, { status: 404 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true });
});
