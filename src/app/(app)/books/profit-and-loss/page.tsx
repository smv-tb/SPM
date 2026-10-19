export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { projectAccessWhere } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { AccountingError } from "@/lib/accounting/errors";
import { loadProfitAndLossReport } from "@/lib/accounting/profit-and-loss-load";
import { ProfitAndLossClient } from "./profit-and-loss-client";

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const query = await searchParams;
  const params = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v ? [[k, v]] : [])));
  const includeZero = params.get("includeZero") === "true";

  const [projects, loaded] = await Promise.all([
    prisma.project.findMany({
      // The books are company-wide, but the project filter only offers projects this person may open.
      where: await projectAccessWhere(session.user!.id!),
      orderBy: { name: "asc" },
      select: { id: true, name: true, phases: { orderBy: { orderIndex: "asc" }, select: { id: true, name: true } } },
    }),
    loadProfitAndLossReport(prisma, params, includeZero).catch((error) => {
      if (error instanceof AccountingError) return { error: error.message };
      throw error;
    }),
  ]);

  return (
    <ProfitAndLossClient
      projects={projects}
      query={Object.fromEntries(params)}
      result={"error" in loaded ? { error: loaded.error } : { reports: loaded.reports, rows: loaded.rows }}
    />
  );
}
