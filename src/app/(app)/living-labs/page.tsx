export const dynamic = "force-dynamic";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LivingLabsClient } from "./living-labs-client";
import { requireCurrentProject } from "@/lib/current-project";

const livingLabInclude = {
  costs: {
    include: {
      owner: { select: { id: true, name: true } },
      costCategory: { select: { name: true } },
    },
    orderBy: { startDate: "asc" },
  },
} satisfies Prisma.LivingLabInclude;

type LabWithCosts = Prisma.LivingLabGetPayload<{ include: typeof livingLabInclude }>;
type CostWithIncludes = LabWithCosts["costs"][number];

async function getData(projectId: string) {
  const labs = await prisma.livingLab.findMany({
    where: { projectId },
    include: livingLabInclude,
    orderBy: { name: "asc" },
  });

  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const serialized = labs.map((lab: LabWithCosts) => {
    const costs = lab.costs.map((c: CostWithIncludes) => ({
      ...c,
      estBudget: Number(c.estBudget),
      actualSpend: Number(c.actualSpend),
      startDate: c.startDate?.toISOString() ?? null,
      endDate: c.endDate?.toISOString() ?? null,
      categoryName: c.costCategory?.name ?? null,
    }));
    // Compute totalBudget from sum of cost line items
    const totalBudget = costs.reduce((sum, c) => sum + c.estBudget, 0);
    return { ...lab, totalBudget, costs };
  });

  return { labs: serialized, users };
}

export default async function LivingLabsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { projectId } = await requireCurrentProject(session.user!.id!);

  const { labs, users } = await getData(projectId);
  return <LivingLabsClient initialLabs={labs} users={users} projectId={projectId} />;
}
