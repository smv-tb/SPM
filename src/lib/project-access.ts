import { cache } from "react";
import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/permissions";
import { assertProjectRole, effectiveRole, isRole, type MembershipMap, type Role } from "@/lib/project-membership";

/**
 * Per-project access (S2.7), the database half of `project-membership.ts`.
 *
 * Reads are scoped by `activeProjects()` (src/lib/current-project.ts), which
 * every project-scoped query already goes through. This file guards the other
 * door: routes that name a project or one of its records directly — by id in the
 * URL, or in the request body.
 *
 *   await requireProjectAccess(session, data.projectId, "work:edit");     // create
 *   await requireEntityAccess(session, "task", id, "work:edit");          // by id
 *
 * Both throw `ProjectAccessError`, which `withErrorHandler` turns into a 404
 * (not a member: the record's existence is not revealed) or a 403 (a member
 * whose role in that project is too low). Nothing here can be skipped by
 * forgetting to check the cookie: the check reads the database.
 */

export interface UserAccess {
  role: Role | null;
  memberships: MembershipMap;
}

/** The account's current role and project memberships. Cached for the request. */
export const loadUserAccess = cache(async (userId: string): Promise<UserAccess> => {
  const [user, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } }),
    prisma.projectMember.findMany({ where: { userId }, select: { projectId: true, role: true } }),
  ]);
  if (!user || !user.isActive) return { role: null, memberships: new Map() };
  return {
    role: user.role,
    memberships: new Map(members.filter((m) => isRole(m.role)).map((m) => [m.projectId, m.role as Role])),
  };
});

/** `where` fragment for `prisma.project` limited to what this user may open. Admins: everything. */
export async function projectAccessWhere(userId: string): Promise<Prisma.ProjectWhereInput> {
  const access = await loadUserAccess(userId);
  if (access.role === "ADMIN") return {};
  if (!access.role) return { id: { in: [] } };
  return { members: { some: { userId } } };
}

export function userIdOf(session: Session): string {
  const id = (session.user as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") throw new Error("A project check needs a signed-in user");
  return id;
}

/** Throws `ProjectAccessError` unless the user may open the project (and, if named, use the capability in it). */
export async function requireProjectAccess(session: Session, projectId: string, permission?: Permission): Promise<Role> {
  const access = await loadUserAccess(userIdOf(session));
  return assertProjectRole(access.role, projectId, access.memberships, permission);
}

/** For pages: whether the signed-in user may open the project (a page answers `notFound()`, not an error). */
export async function canOpenProject(session: Session, projectId: string): Promise<boolean> {
  const access = await loadUserAccess(userIdOf(session));
  return effectiveRole(access.role, projectId, access.memberships) !== null;
}

type Entity =
  | "task" | "milestone" | "resource" | "phase" | "tag" | "fundingRecord" | "fundingTranche"
  | "livingLab" | "livingLabCost" | "customFieldDefinition" | "customFieldValue";

/** The project a record belongs to, or null when there is no such record. */
const PROJECT_OF: Record<Entity, (id: string) => Promise<string | null | undefined>> = {
  task: async (id) => (await prisma.task.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  milestone: async (id) => (await prisma.milestone.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  resource: async (id) => (await prisma.resource.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  phase: async (id) => (await prisma.phase.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  tag: async (id) => (await prisma.tag.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  fundingRecord: async (id) => (await prisma.fundingRecord.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  fundingTranche: async (id) =>
    (await prisma.fundingTranche.findUnique({ where: { id }, select: { fundingRecord: { select: { projectId: true } } } }))?.fundingRecord.projectId,
  livingLab: async (id) => (await prisma.livingLab.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  livingLabCost: async (id) =>
    (await prisma.livingLabCost.findUnique({ where: { id }, select: { lab: { select: { projectId: true } } } }))?.lab.projectId,
  customFieldDefinition: async (id) =>
    (await prisma.customFieldDefinition.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  customFieldValue: async (id) =>
    (await prisma.customFieldValue.findUnique({ where: { id }, select: { definition: { select: { projectId: true } } } }))?.definition.projectId,
};

/**
 * Same check for a record reached by id. A record that does not exist passes
 * (the route's own 404 follows), so this adds no way to tell "missing" from
 * "not yours" beyond what the route already answers.
 */
export async function requireEntityAccess(session: Session, entity: Entity, id: string, permission?: Permission): Promise<void> {
  const projectId = await PROJECT_OF[entity](id);
  if (!projectId) return;
  await requireProjectAccess(session, projectId, permission);
}

/** The projects a user may open, archived included. Admins: null, meaning all of them. */
export async function accessibleProjectIds(userId: string): Promise<string[] | null> {
  const access = await loadUserAccess(userId);
  if (access.role === "ADMIN") return null;
  return [...access.memberships.keys()];
}
