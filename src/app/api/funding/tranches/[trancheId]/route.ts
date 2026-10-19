export const dynamic = "force-dynamic";
import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";
import { fundingTrancheUpdateSchema } from "@/schemas/funding-tranche";

type RouteContext = { params: Promise<{ trancheId: string }> };

export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { trancheId } = await params;

  await requireEntityAccess(session, "fundingTranche", trancheId, "funding:edit");
  const body = await req.json();
  const validation = fundingTrancheUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;
  // Moving a tranche back off RECEIVED must drop the receipt date with it —
  // otherwise the row reads as unsettled while still carrying a settled-on date,
  // and anything keyed on receivedDate (cash-in reporting) double-counts it.
  if (data.status !== undefined && data.status !== "RECEIVED" && data.receivedDate === undefined) {
    data.receivedDate = null;
  }

  const tranche = await prisma.$transaction(async (tx) => {
    const existing = await tx.fundingTranche.findUnique({ where: { id: trancheId } });
    if (!existing) return null;

    const updated = await tx.fundingTranche.update({ where: { id: trancheId }, data });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "tranche.update",
      entityType: "FundingTranche",
      entityId: trancheId,
      before: existing,
      after: updated,
      ipAddress: requestIp(req),
    });
    return updated;
  });

  if (!tranche) {
    return NextResponse.json({ error: "Tranche not found" }, { status: 404 });
  }
  return NextResponse.json(tranche);
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:delete")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { trancheId } = await params;

  await requireEntityAccess(session, "fundingTranche", trancheId, "funding:delete");
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const existing = await tx.fundingTranche.findUnique({ where: { id: trancheId } });
      if (!existing) return false;

      await tx.fundingTranche.delete({ where: { id: trancheId } });
      await recordAudit(tx, {
        actor: actorFromSession(session),
        action: "tranche.delete",
        entityType: "FundingTranche",
        entityId: trancheId,
        before: existing,
        ipAddress: requestIp(req),
      });
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "Tranche not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Tranche not found" }, { status: 404 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true });
});
