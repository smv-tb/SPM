export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { withErrorHandler } from "@/lib/api-errors";
import { activeProjects } from "@/lib/current-project";
import { ALL_PROJECTS, CURRENT_PROJECT_COOKIE } from "@/lib/project-scope";

const bodySchema = z.object({ projectId: z.string().min(1).max(100) });

/**
 * Switches the caller's current project (or the portfolio view, "all"). It
 * only remembers a choice in a cookie: every read re-checks it in
 * `resolveProjectScope`, so a forged cookie gets no further than this check.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  const sessionUser = session?.user as { id?: string } | undefined;
  if (!sessionUser?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a project" }, { status: 400 });
  const wanted = parsed.data.projectId;

  if (wanted !== ALL_PROJECTS) {
    const projects = await activeProjects(sessionUser.id);
    if (!projects.some((p) => p.id === wanted)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  const res = NextResponse.json({ projectId: wanted });
  res.cookies.set(CURRENT_PROJECT_COOKIE, wanted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
});
