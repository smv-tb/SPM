export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { activeProjects } from "@/lib/current-project";

const bodySchema = z.object({ projectId: z.string().min(1).max(100).nullable() });

/** Sets (or clears) the project the caller opens when they haven't chosen one. */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  const sessionUser = session?.user as { id?: string } | undefined;
  if (!sessionUser?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a project" }, { status: 400 });
  const wanted = parsed.data.projectId;

  if (wanted && !(await activeProjects(sessionUser.id)).some((p) => p.id === wanted)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  await prisma.user.update({ where: { id: sessionUser.id }, data: { defaultProjectId: wanted } });
  return NextResponse.json({ defaultProjectId: wanted });
});
