export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { actorFromSession, requestIp } from "@/lib/audit";
import { recordUserChanged } from "@/lib/user-audit";

const bodySchema = z.object({ name: z.string().trim().min(1, "Enter your name").max(100) });

const SNAPSHOT = { email: true, name: true, role: true, isActive: true, mustChangePassword: true } as const;

/**
 * The caller changes their own display name. Email and role are an admin's to
 * change (they affect sign-in and access); a name does neither, so it doesn't
 * rotate the security stamp — but it is audited like any other user change.
 */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  const sessionUser = session?.user as { id?: string } | undefined;
  if (!session || !sessionUser?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid name" }, { status: 400 });
  }
  const userId = sessionUser.id;

  const user = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: SNAPSHOT });
    if (before.name === parsed.data.name) return before;
    const after = await tx.user.update({ where: { id: userId }, data: { name: parsed.data.name }, select: SNAPSHOT });
    await recordUserChanged(tx, { actor: actorFromSession(session), ipAddress: requestIp(req) }, userId, before, after, {
      passwordReset: false,
    });
    return after;
  });
  return NextResponse.json({ name: user.name });
});
