import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CURRENT_PROJECT_COOKIE, chooseScope, projectWhere } from "@/lib/project-scope";
import { projectAccessWhere } from "@/lib/project-access";

/**
 * The current project. **Every page and route that shows project data resolves
 * it here** — never with `prisma.project.findFirst()`, which silently picks one
 * project out of many. This is also the single place per-project membership is
 * applied (S2.7): admins see every active project, everyone else only those
 * they are a member of. Routes that name a project or record directly are
 * guarded by `requireProjectAccess` / `requireEntityAccess` in project-access.ts.
 */

export interface ProjectOption {
  id: string;
  name: string;
  logoUrl: string | null;
  startDate: Date | null;
  historicalSpend: number;
}

export type ProjectScope =
  | { kind: "project"; projectId: string; project: ProjectOption; projects: ProjectOption[] }
  | { kind: "all"; projectIds: string[]; projects: ProjectOption[] };

/** Projects this user may open, oldest first. Cached for the request. */
export const activeProjects = cache(async (userId: string): Promise<ProjectOption[]> => {
  const rows = await prisma.project.findMany({
    where: { archivedAt: null, ...(await projectAccessWhere(userId)) },
    select: { id: true, name: true, logoUrl: true, startDate: true, historicalSpend: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ ...r, historicalSpend: Number(r.historicalSpend) }));
});

const userDefaultProject = cache(async (userId: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultProjectId: true } });
  return user?.defaultProjectId ?? null;
});

/**
 * Resolves the scope, or null when there is no active project at all.
 * `requested` is an explicit choice (an API's `?projectId=`); it is checked
 * against the same list as the cookie, so it can never reach a project the
 * user could not have switched to.
 */
export async function resolveProjectScope(
  userId: string,
  opts: { allowAll?: boolean; requested?: string | null } = {}
): Promise<ProjectScope | null> {
  const [projects, defaultProjectId, store] = await Promise.all([
    activeProjects(userId),
    userDefaultProject(userId),
    cookies(),
  ]);
  const choice = chooseScope({
    active: projects,
    requested: opts.requested,
    cookie: store.get(CURRENT_PROJECT_COOKIE)?.value,
    defaultProjectId,
    allowAll: opts.allowAll,
  });
  if (choice.kind === "none") return null;
  if (choice.kind === "all") return { kind: "all", projectIds: projects.map((p) => p.id), projects };
  const project = projects.find((p) => p.id === choice.projectId)!;
  return { kind: "project", projectId: project.id, project, projects };
}

/** For pages: the current project, or off to create one. */
export async function requireCurrentProject(userId: string) {
  const scope = await resolveProjectScope(userId);
  if (!scope || scope.kind !== "project") redirect("/settings/projects");
  return scope;
}

export { projectWhere };

/**
 * For API reads: a `where` fragment for the project the caller is looking at.
 * An explicit `?projectId=` wins over the cookie but is checked the same way;
 * with no project at all it matches nothing rather than everything.
 */
export async function projectFilterForRequest(
  userId: string,
  req: { nextUrl: URL } | Request,
  opts: { allowAll?: boolean } = {}
): Promise<{ projectId: string | { in: string[] } }> {
  const url = "nextUrl" in req ? req.nextUrl : new URL(req.url);
  const scope = await resolveProjectScope(userId, { ...opts, requested: url.searchParams.get("projectId") });
  return scope ? projectWhere(scope) : { projectId: { in: [] } };
}
