export const dynamic = "force-dynamic";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { projectFilterForRequest } from "@/lib/current-project";

const livingLabInclude = {
  costs: {
    include: { owner: { select: { id: true, name: true } } },
    orderBy: { startDate: "asc" },
  },
} satisfies Prisma.LivingLabInclude;

type LabWithCosts = Prisma.LivingLabGetPayload<{ include: typeof livingLabInclude }>;
type CostWithIncludes = LabWithCosts["costs"][number];

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const labs = await prisma.livingLab.findMany({
    where: await projectFilterForRequest(session.user!.id!, req),
    include: livingLabInclude,
    orderBy: { name: "asc" },
  });

  const serialized = labs.map((lab: LabWithCosts) => ({
    ...lab,
    totalBudget: Number(lab.totalBudget),
    costs: lab.costs.map((c: CostWithIncludes) => ({
      ...c,
      estBudget: Number(c.estBudget),
      actualSpend: Number(c.actualSpend),
      startDate: c.startDate?.toISOString() ?? null,
      endDate: c.endDate?.toISOString() ?? null,
    })),
  }));

  return NextResponse.json(serialized);
});
