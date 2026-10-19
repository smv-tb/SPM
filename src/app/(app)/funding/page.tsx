export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { summarizeTranches } from "@/lib/funding";
import { FundingClient } from "./funding-client";
import { requireCurrentProject } from "@/lib/current-project";
import { hasPermission } from "@/lib/permissions";

async function getData(projectId: string) {
  const records = await prisma.fundingRecord.findMany({
    where: { projectId },
    include: {
      phase: { select: { name: true } },
      tranches: { select: { amount: true, status: true, direction: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const phases = await prisma.phase.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { orderIndex: "asc" },
  });

  const serialized = records.map((r) => ({
    ...r,
    amount: Number(r.amount),
    date: r.date?.toISOString() || null,
    periodStart: r.periodStart?.toISOString() || null,
    periodEnd: r.periodEnd?.toISOString() || null,
    createdAt: r.createdAt.toISOString(),
    deadline: r.deadline?.toISOString() || null,
    nextActionDate: r.nextActionDate?.toISOString() || null,
    trancheSummary: summarizeTranches(r.tranches),
  }));

  return { records: serialized, projectId, phases };
}

export default async function FundingPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const current = await requireCurrentProject(session.user!.id!);
  const { records, projectId, phases } = await getData(current.projectId);
  return <FundingClient initialRecords={records} projectId={projectId} phases={phases} canEditProject={hasPermission(session, "project:edit")} />;
}
