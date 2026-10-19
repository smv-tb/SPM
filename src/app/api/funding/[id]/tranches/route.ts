export const dynamic = "force-dynamic";
import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { fundingTrancheSchema } from "@/schemas/funding-tranche";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await requireEntityAccess(session, "fundingRecord", id);
  const tranches = await prisma.fundingTranche.findMany({
    where: { fundingRecordId: id },
    orderBy: { dueDate: "asc" },
  });
  return NextResponse.json(tranches);
});

export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "fundingRecord", id, "funding:edit");
  const fundingRecord = await prisma.fundingRecord.findUnique({ where: { id } });
  if (!fundingRecord) {
    return NextResponse.json({ error: "Funding record not found" }, { status: 404 });
  }

  const body = await req.json();
  // Trust the URL, not the body, for which record this tranche belongs to.
  const validation = fundingTrancheSchema.safeParse({ ...body, fundingRecordId: id });
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;
  const tranche = await prisma.$transaction(async (tx) => {
    const created = await tx.fundingTranche.create({
      data: {
        fundingRecordId: data.fundingRecordId,
        label: data.label,
        amount: data.amount,
        dueDate: data.dueDate,
        receivedDate: data.receivedDate ?? null,
        status: data.status,
        direction: data.direction,
        milestoneId: data.milestoneId ?? null,
      },
    });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "tranche.create",
      entityType: "FundingTranche",
      entityId: created.id,
      after: created,
      ipAddress: requestIp(req),
    });
    return created;
  });

  return NextResponse.json(tranche, { status: 201 });
});
