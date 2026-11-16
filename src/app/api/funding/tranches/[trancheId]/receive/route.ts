export const dynamic = "force-dynamic";
import { requireEntityAccess } from "@/lib/project-access";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";
import { fundingTrancheReceiveSchema } from "@/schemas/funding-tranche";
import { ALREADY_RECEIVED, receiveTranche } from "@/lib/funding-tranches";

type RouteContext = { params: Promise<{ trancheId: string }> };

// Dedicated "mark received" action — a single unambiguous affordance for
// UI/Hermes callers, instead of requiring them to construct a full PUT payload.
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "funding:edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { trancheId } = await params;

  await requireEntityAccess(session, "fundingTranche", trancheId, "funding:edit");
  const body = await req.json().catch(() => ({}));
  const validation = fundingTrancheReceiveSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const outcome = await receiveTranche(tx, trancheId, validation.data.receivedDate ?? new Date());
    if (outcome.kind === "received") {
      await recordAudit(tx, {
        actor: actorFromSession(session),
        action: "tranche.receive",
        entityType: "FundingTranche",
        entityId: trancheId,
        before: outcome.before,
        after: outcome.after,
        ipAddress: requestIp(req),
      });
    }
    return outcome;
  });

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Tranche not found" }, { status: 404 });
  }
  if (result.kind === "already_received") {
    return NextResponse.json(ALREADY_RECEIVED, { status: 409 });
  }
  return NextResponse.json(result.after);
});
