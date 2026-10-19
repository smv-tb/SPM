import type { Prisma } from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { AccountingError } from "@/lib/accounting/errors";
import { MEMBER_ROLES, type MemberRole } from "@/lib/project-membership";

/**
 * Changing who may open a project (S2.7). Every change takes the caller's
 * transaction and writes its audit row in it, like user changes (user-audit.ts).
 * Admins reach every project without a row, so they are never members.
 */

type Tx = Prisma.TransactionClient;

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  accountRole: string;
  isActive: boolean;
  role: string;
  addedAt: string;
}

export async function listMembers(db: Tx | Prisma.DefaultPrismaClient, projectId: string): Promise<MemberRow[]> {
  const rows = await db.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { name: true, email: true, role: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    accountRole: m.user.role,
    isActive: m.user.isActive,
    role: m.role,
    addedAt: m.createdAt.toISOString(),
  }));
}

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Adds the user to the project, or changes their role in it. Returns what was done. */
export async function setMember(
  tx: Tx,
  input: { projectId: string; userId: string; role: MemberRole; actor: AuditActor; addedById: string; ipAddress: string | null }
): Promise<"added" | "changed" | "unchanged"> {
  const [project, user, existing] = await Promise.all([
    tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } }),
    tx.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, isActive: true } }),
    tx.projectMember.findUnique({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } } }),
  ]);
  if (!project) throw new AccountingError("NOT_FOUND", "Project not found", 404);
  if (!user) throw new AccountingError("NOT_FOUND", "User not found", 404);
  if (user.role === "ADMIN") {
    throw new AccountingError("ADMIN_HAS_ACCESS", "Administrators can open every project; they don't need to be added", 409);
  }
  if (!user.isActive) throw new AccountingError("USER_INACTIVE", "That account is deactivated", 409);
  if (existing?.role === input.role) return "unchanged";

  await tx.projectMember.upsert({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
    create: { projectId: input.projectId, userId: input.userId, role: input.role, addedById: input.addedById },
    update: { role: input.role },
  });
  await recordAudit(tx, {
    actor: input.actor,
    action: existing ? "project.member_role_change" : "project.member_add",
    entityType: "Project",
    entityId: input.projectId,
    before: existing ? { userId: input.userId, role: existing.role } : undefined,
    after: { userId: input.userId, role: input.role },
    ipAddress: input.ipAddress,
  });
  return existing ? "changed" : "added";
}

export async function removeMember(
  tx: Tx,
  input: { projectId: string; userId: string; actor: AuditActor; ipAddress: string | null }
): Promise<boolean> {
  const existing = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
  });
  if (!existing) return false;
  await tx.projectMember.delete({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } } });
  await recordAudit(tx, {
    actor: input.actor,
    action: "project.member_remove",
    entityType: "Project",
    entityId: input.projectId,
    before: { userId: input.userId, role: existing.role },
    ipAddress: input.ipAddress,
  });
  return true;
}
