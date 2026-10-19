import { roleHasPermission, type Permission } from "@/lib/permissions";

/**
 * Who may open and change which project (S2.7). Pure — no Prisma, no session —
 * so the rules are unit-tested and the screens can reuse them. The database
 * half is `src/lib/project-access.ts`; the list of openable projects comes from
 * `activeProjects()` in `src/lib/current-project.ts`.
 *
 * - An ADMIN reaches every project, member or not.
 * - Everyone else reaches only the projects they are a member of.
 * - In a project a member's effective role is the *lower* of their account role
 *   and their membership role: a membership can narrow someone (a PM who is only
 *   a viewer on one project) but never promote them.
 */

export type Role = "ADMIN" | "PM" | "CONTRIBUTOR" | "VIEWER";

const RANK: Record<Role, number> = { VIEWER: 0, CONTRIBUTOR: 1, PM: 2, ADMIN: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RANK, value);
}

export function lowerRole(a: Role, b: Role): Role {
  return RANK[a] <= RANK[b] ? a : b;
}

export type MembershipMap = ReadonlyMap<string, Role>;

/** The user's role in a project, or null when they may not open it. */
export function effectiveRole(account: unknown, projectId: string, memberships: MembershipMap): Role | null {
  if (!isRole(account)) return null;
  if (account === "ADMIN") return "ADMIN";
  const member = memberships.get(projectId);
  if (!member) return null;
  return lowerRole(account, member);
}

/** Raised when a project is not open to the caller (404: its existence is not revealed) or the caller's role there is too low (403). */
export class ProjectAccessError extends Error {
  constructor(public readonly reason: "not_member" | "insufficient_role", public readonly projectId: string) {
    super(reason === "not_member" ? "Not found" : "You don't have permission to do that in this project");
    this.name = "ProjectAccessError";
  }
  get status(): number {
    return this.reason === "not_member" ? 404 : 403;
  }
}

export function isProjectAccessError(error: unknown): error is ProjectAccessError {
  return error instanceof ProjectAccessError;
}

/**
 * The check behind `requireProjectAccess`: throws unless the user may open the
 * project and, when a capability is named, may use it *in this project*.
 */
export function assertProjectRole(
  account: unknown,
  projectId: string,
  memberships: MembershipMap,
  permission?: Permission
): Role {
  const role = effectiveRole(account, projectId, memberships);
  if (!role) throw new ProjectAccessError("not_member", projectId);
  if (permission && !roleHasPermission(role, permission)) throw new ProjectAccessError("insufficient_role", projectId);
  return role;
}

/** Roles a membership may carry. Admin is reached through the account, never through a membership. */
export const MEMBER_ROLES = ["PM", "CONTRIBUTOR", "VIEWER"] as const satisfies readonly Role[];
export type MemberRole = (typeof MEMBER_ROLES)[number];
