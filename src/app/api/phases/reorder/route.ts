import { requireEntityAccess } from "@/lib/project-access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { phasesReorderSchema } from "@/schemas/phase";

export const POST = withErrorHandler(async (req: Request) => {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "project:structure")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validation = phasesReorderSchema.safeParse(body.phases);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid phases array", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const phases = validation.data;
  for (const phase of phases) await requireEntityAccess(session, "phase", phase.id, "project:structure");

  await prisma.$transaction(
    phases.map((phase) =>
      prisma.phase.update({
        where: { id: phase.id },
        data: { orderIndex: phase.orderIndex },
      })
    )
  );

  return NextResponse.json({ success: true });
});
