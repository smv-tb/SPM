import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";
import { fundingUpdateSchema } from "@/schemas/funding";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "fundingRecord", id, "funding:edit");
  const body = await req.json();

  const validation = fundingUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const data = validation.data;

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.fundingRecord.findUnique({ where: { id } });
    if (!existing) return null;

    const updated = await tx.fundingRecord.update({ where: { id }, data });
    await recordAudit(tx, {
      actor: actorFromSession(session),
      action: "funding.update",
      entityType: "FundingRecord",
      entityId: id,
      before: existing,
      after: updated,
      ipAddress: requestIp(req),
    });
    return updated;
  });

  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  return NextResponse.json(record);
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:delete")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  await requireEntityAccess(session, "fundingRecord", id, "funding:delete");
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      // Tranches cascade with the record, so they go into the snapshot too —
      // otherwise the repayment/receipt history would vanish without trace.
      const existing = await tx.fundingRecord.findUnique({ where: { id }, include: { tranches: true } });
      if (!existing) return false;

      await tx.fundingRecord.delete({ where: { id } });
      await recordAudit(tx, {
        actor: actorFromSession(session),
        action: "funding.delete",
        entityType: "FundingRecord",
        entityId: id,
        before: existing,
        ipAddress: requestIp(req),
      });
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true });
});
