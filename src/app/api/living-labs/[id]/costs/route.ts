export const dynamic = "force-dynamic";
import { requireEntityAccess } from "@/lib/project-access";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { livingLabCostCreateSchema } from "@/schemas/living-lab";

type RouteContext = { params: Promise<{ id: string }> };

const labWithCostsInclude = {
  costs: {
    include: {
      owner: { select: { id: true, name: true } },
      costCategory: { select: { id: true, name: true } },
      task: { select: { id: true, code: true, title: true } },
    },
    orderBy: { startDate: "asc" },
  },
} satisfies Prisma.LivingLabInclude;

type LabWithCosts = Prisma.LivingLabGetPayload<{ include: typeof labWithCostsInclude }>;
type CostWithIncludes = LabWithCosts["costs"][number];

export const GET = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: labId } = await params;

  await requireEntityAccess(session, "livingLab", labId);

  const lab = await prisma.livingLab.findUnique({
    where: { id: labId },
    include: labWithCostsInclude,
  });

  if (!lab) return NextResponse.json({ error: "Living lab not found" }, { status: 404 });

  const serialized = {
    ...lab,
    totalBudget: Number(lab.totalBudget),
    costs: lab.costs.map((c: CostWithIncludes) => ({
      ...c,
      estBudget: Number(c.estBudget),
      actualSpend: Number(c.actualSpend),
      startDate: c.startDate?.toISOString() ?? null,
      endDate: c.endDate?.toISOString() ?? null,
    })),
  };

  return NextResponse.json(serialized);
});

export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "work:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: labId } = await params;

  await requireEntityAccess(session, "livingLab", labId, "work:edit");
  const body = await req.json();

  const validation = livingLabCostCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  const lab = await prisma.livingLab.findUnique({ where: { id: labId } });
  if (!lab) return NextResponse.json({ error: "Living lab not found" }, { status: 404 });

  const cost = await prisma.livingLabCost.create({
    data: {
      labId,
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
  }, { status: 201 });
});
