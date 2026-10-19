/**
 * Which project a request is about. Pure — no Prisma, no cookies — so the
 * rules are unit-tested and the switcher can share the constants client-side.
 * The database half is `src/lib/current-project.ts`.
 */

/** Cookie holding the user's chosen project id, or ALL_PROJECTS. */
export const CURRENT_PROJECT_COOKIE = "pm_project";
/** Cookie value for the portfolio view; only screens that pass `allowAll` honour it. */
export const ALL_PROJECTS = "all";

export type ScopeChoice =
  | { kind: "project"; projectId: string }
  | { kind: "all" }
  | { kind: "none" };

/**
 * Picks the project for a request.
 *
 * `active` is every project the user may open, oldest first (archived ones are
 * already left out). Preference: an explicit request (an API `?projectId=`),
 * then the cookie, then the user's default, then the oldest project. Anything
 * not in `active` is ignored rather than trusted — a stale cookie for an
 * archived project, or later a project the user is not a member of, falls
 * through to the next choice.
 */
export function chooseScope(input: {
  active: readonly { id: string }[];
  requested?: string | null;
  cookie?: string | null;
  defaultProjectId?: string | null;
  allowAll?: boolean;
}): ScopeChoice {
  const { active, requested, cookie, defaultProjectId, allowAll = false } = input;
  if (active.length === 0) return { kind: "none" };
  const ids = new Set(active.map((p) => p.id));

  for (const candidate of [requested, cookie]) {
    if (!candidate) continue;
    if (candidate === ALL_PROJECTS) {
      if (allowAll) return { kind: "all" };
      continue;
    }
    if (ids.has(candidate)) return { kind: "project", projectId: candidate };
  }
  if (defaultProjectId && ids.has(defaultProjectId)) {
    return { kind: "project", projectId: defaultProjectId };
  }
  return { kind: "project", projectId: active[0].id };
}

/** Prisma `where` fragment for any model with a `projectId` column. */
export function projectWhere(
  scope: { kind: "project"; projectId: string } | { kind: "all"; projectIds: string[] }
): { projectId: string | { in: string[] } } {
  return scope.kind === "project" ? { projectId: scope.projectId } : { projectId: { in: scope.projectIds } };
}

/** Raised by the database (`refuse_archived_project_write`) for any write to an archived project. */
export const PROJECT_ARCHIVED_MESSAGE = "This project is archived. Restore it to make changes.";

/** Whether an error, however the driver wraps it, is the archived-project trigger refusing a write. */
export function isProjectArchivedError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const err = e as { message?: unknown; meta?: unknown; cause?: unknown };
    if (typeof err.message === "string" && err.message.includes("PROJECT_ARCHIVED")) return true;
    if (err.meta && JSON.stringify(err.meta).includes("PROJECT_ARCHIVED")) return true;
    e = err.cause;
  }
  return false;
}
