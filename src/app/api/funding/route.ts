export const dynamic = "force-dynamic";
import { requireProjectAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { projectFilterForRequest } from "@/lib/current-project";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_LIMIT, FUNDING_MAX_PAGE_LIMIT } from "@/lib/constants";
import { fundingSchema } from "@/schemas/funding";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";
import {
  computeFundingForecast,
  computePhaseUtilization,
  computeSecuredCash,
  computeTaskSpend,
  summarizeTranches,
} from "@/lib/funding";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl.searchParams;
  const includeUtilization = url.get("utilization") === "true";
  const summary = url.get("summary") === "true";
  const forecast = url.get("forecast") === "true";
  const cursor = url.get("cursor");

  const fetchAll = summary || includeUtilization || forecast;
  const where = await projectFilterForRequest(session.user!.id!, req);

  // When fetching all records (summary/utilization), skip the paginated query
  // and load everything in one shot. Avoids a wasteful double-query.
  if (fetchAll) {
    const allRecords = await prisma.fundingRecord.findMany({
      where,
      include: { phase: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    if (summary) {
      // `totalSecured` must mean the same thing here as it does in the
      // analytics route and on the dashboard — verified funding only. It used
      // to count unverified records too, so the same label showed two
      // different numbers depending on which endpoint the screen called.
      const secured = allRecords.filter(
        r => r.verified && (r.section === "FOUNDER" || r.section === "LIVE")
      );
      const pipeline = allRecords.filter(r => r.section === "PIPELINE");
      const { totalPipeline, weightedForecast } = computeFundingForecast(allRecords);

      return NextResponse.json({
        totalSecured: computeSecuredCash(allRecords),
        totalPipeline,
        weightedForecast,
        securedCount: secured.length,
        pipelineCount: pipeline.length,
      });
    }

    if (forecast) {
      return NextResponse.json(computeFundingForecast(allRecords));
    }

    if (includeUtilization) {
      // Roll task spend up to the phase that funds it (Task → Milestone →
      // Phase), which is the only link that ties spend to a specific funding
      // record. Charging every record the whole project's spend made every
      // record but the largest read as over budget.
      const [milestoneAggregates, milestones] = await Promise.all([
        prisma.task.groupBy({
          by: ['milestoneId'],
          where,
          _sum: { actualSpend: true, extCosts: true },
        }),
        prisma.milestone.findMany({ where, select: { id: true, phaseId: true } }),
      ]);

      const phaseByMilestone = new Map(milestones.map(m => [m.id, m.phaseId]));
      const spendByPhase = new Map<string, number>();
      for (const agg of milestoneAggregates) {
        const phaseId = phaseByMilestone.get(agg.milestoneId);
        if (!phaseId) continue;
        const spend = computeTaskSpend(agg._sum.actualSpend, agg._sum.extCosts);
        spendByPhase.set(phaseId, (spendByPhase.get(phaseId) ?? 0) + spend);
      }

      const utilizationByRecord = computePhaseUtilization(allRecords, spendByPhase);

      const enrichedRecords = allRecords.map((record) => ({
        ...record,
        ...utilizationByRecord.get(record.id)!,
        startDate: record.createdAt.toISOString(),
      }));

      return NextResponse.json({
        FOUNDER: enrichedRecords.filter(r => r.section === "FOUNDER"),
        LIVE: enrichedRecords.filter(r => r.section === "LIVE"),
        PIPELINE: enrichedRecords.filter(r => r.section === "PIPELINE"),
      });
    }

    // All-records fetch without summary or utilization — return everything
    return NextResponse.json({
      FOUNDER: allRecords.filter(r => r.section === "FOUNDER"),
      LIVE: allRecords.filter(r => r.section === "LIVE"),
      PIPELINE: allRecords.filter(r => r.section === "PIPELINE"),
    });
  }

  // Paginated path (default)
  const take = Math.min(Number(url.get("limit")) || DEFAULT_PAGE_LIMIT, FUNDING_MAX_PAGE_LIMIT);
  const records = await prisma.fundingRecord.findMany({
    where,
    take: take + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      phase: { select: { id: true, name: true } },
      tranches: { select: { amount: true, status: true, direction: true } },
    },
    // `id` is the tiebreaker, not decoration: every ODS-migrated record shares
    // a createdAt, and cursor pagination over a non-total ordering silently
    // drops or repeats rows at the page boundary.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const hasMore = records.length > take;
  if (hasMore) records.pop();
  const nextCursor = hasMore ? records[records.length - 1]?.id ?? null : null;

  const enriched = records.map((r) => ({ ...r, trancheSummary: summarizeTranches(r.tranches) }));

  return NextResponse.json({
    FOUNDER: enriched.filter(r => r.section === "FOUNDER"),
    LIVE: enriched.filter(r => r.section === "LIVE"),
    PIPELINE: enriched.filter(r => r.section === "PIPELINE"),
    nextCursor,
    hasMore,
  });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = fundingSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }
  const data = validation.data;
  await requireProjectAccess(session, data.projectId, "funding:edit");

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.fundingRecord.create({
    data: {
      fundId: data.fundId,
      fundName: data.fundName,
      type: data.type,
      section: data.section,
      source: data.source,
      date: data.date ?? null,
      periodStart: data.periodStart ?? null,
      periodEnd: data.periodEnd ?? null,
      amount: data.amount,
      currency: data.currency,
      coverageDesc: data.coverageDesc ?? null,
      projectId: data.projectId,
      phaseId: data.phaseId ?? null,
      verified: data.verified,
      notes: data.notes ?? null,
      stage: data.stage ?? null,
      probability: data.probability ?? null,
      deadline: data.deadline ?? null,
      nextAction: data.nextAction ?? null,
      nextActionDate: data.nextActionDate ?? null,
      contactName: data.contactName ?? null,
      contactEmail: data.contactEmail ?? null,
      funderUrl: data.funderUrl ?? null,
    },
    });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "funding.create",
      entityType: "FundingRecord",
      entityId: created.id,
      after: created,
      ipAddress: requestIp(req),
    });
    return created;
  });

  return NextResponse.json(record, { status: 201 });
});
