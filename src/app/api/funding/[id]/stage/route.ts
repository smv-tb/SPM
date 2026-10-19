export const dynamic = "force-dynamic";
import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { fundingStageUpdateSchema } from "@/schemas/funding";
import { FUNDING_STAGE_META, isTerminalStage } from "@/lib/funding";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

// Lightweight, single-purpose endpoint for the Kanban board's drag-to-change-stage
// interaction. Deliberately does NOT move section/verified on AWARDED — that's a
// separate, user-confirmed PUT from the client so this endpoint stays safe for
// direct callers (e.g. Hermes) that only want to change the stage.
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "fundingRecord", id, "funding:edit");
  const body = await req.json();
  const validation = fundingStageUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const { stage } = validation.data;

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.fundingRecord.findUnique({ where: { id } });
    if (!existing) return { status: 404 as const };
    if (existing.section !== "PIPELINE") return { status: 400 as const };

    // Snap probability to the stage's definition on any terminal move: AWARDED is
    // 100, REJECTED/WITHDRAWN are 0. Without the 0 case a lost bid kept its last
    // live probability and kept contributing to the weighted forecast.
    const isTerminal = isTerminalStage(stage);
    const updated = await tx.fundingRecord.update({
      where: { id },
      data: {
        stage,
        ...(isTerminal ? { probability: FUNDING_STAGE_META[stage].defaultProbability } : {}),
      },
    });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "funding.stage",
      entityType: "FundingRecord",
      entityId: id,
      before: existing,
      after: updated,
      ipAddress: requestIp(req),
    });
    return { status: 200 as const, record: updated };
  });

  if (result.status === 404) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  if (result.status === 400) {
    return NextResponse.json(
      { error: "Stage only applies to pipeline records" },
      { status: 400 }
    );
  }
  return NextResponse.json(result.record);
});
