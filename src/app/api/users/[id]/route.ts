export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, apiError, apiSuccess, withErrorHandler } from "@/lib/api-errors";
import { BCRYPT_ROUNDS } from "@/lib/constants";
import { userUpdateSchema, firstPasswordMessage } from "@/schemas/user";
import bcrypt from "bcryptjs";
import { stepUpGuard } from "@/lib/mfa/step-up";
import { changeEndsSessions, newSecurityStamp, resetRequiresChange } from "@/lib/session-validity";
import { passwordIssues } from "@/lib/password-policy";
import { actorFromSession, requestIp } from "@/lib/audit";
import { recordUserChanged, recordUserDeleted } from "@/lib/user-audit";
import { alertInBackground, becameAdmin } from "@/lib/security-alerts";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (_req: NextRequest, { params }: RouteContext) => {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) return apiError("User not found", 404);
  return apiSuccess(user);
});

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;

  const { id } = await params;
  const body = await req.json();

  const validation = userUpdateSchema.safeParse(body);
  if (!validation.success) {
    return apiError(firstPasswordMessage(validation.error) ?? "Invalid request data", 400, validation.error.flatten());
  }

  const { name, email, role, isActive, password } = validation.data;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return apiError("User not found", 404);

  if (password) {
    const issues = passwordIssues(password, {
      email: email ?? existing.email,
      name: name ?? existing.name,
    });
    if (issues.length > 0) return apiError(issues[0], 400, { password: issues });
  }

  const sessionUser = authResult.session.user as { id?: string; role?: string };

  // Role, activation and password changes decide who can get in, so they need a fresh
  // second-factor check; editing a name or email does not.
  if (changeEndsSessions(existing, { role, isActive, password })) {
    const refusal = await stepUpGuard(authResult.session);
    if (refusal) return refusal;
  }

  // Prevent self-demotion from ADMIN
  if (id === sessionUser.id && role && role !== "ADMIN") {
    return apiError("You cannot demote yourself from admin", 403);
  }

  // Prevent deactivating yourself
  if (id === sessionUser.id && isActive === false) {
    return apiError("You cannot deactivate your own account", 403);
  }

  // Prevent last admin from being demoted or deactivated
  if ((role && role !== "ADMIN") || isActive === false) {
    if (existing.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
      if (adminCount <= 1) {
        return apiError("Cannot modify the last active admin", 403);
      }
    }
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (email !== undefined) data.email = email;
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (password && password.length > 0) {
    data.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // Someone else's new password is a temporary one; your own is not.
    data.mustChangePassword = resetRequiresChange(sessionUser.id, id);
  }
  // Role, activation and password changes end the user's existing sessions.
  if (changeEndsSessions(existing, { role, isActive, password })) {
    data.securityStamp = newSecurityStamp();
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
          isActive: true,
          mustChangePassword: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await recordUserChanged(
        tx,
        { actor: actorFromSession(authResult.session), ipAddress: requestIp(req) },
        id,
        existing,
        result,
        { passwordReset: Boolean(password && password.length > 0) }
      );
      return result;
    });
    if (becameAdmin(existing.role, updated.role)) {
      alertInBackground({
        event: "user.admin_granted",
        summary: `${updated.email} was made an administrator`,
        actor: (authResult.session.user as { email?: string }).email ?? null,
        target: updated.email,
        ipAddress: requestIp(req),
      });
    }
    return apiSuccess(updated);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiError("Email already in use", 409);
    }
    throw error;
  }
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  const refusal = await stepUpGuard(authResult.session);
  if (refusal) return refusal;

  const { id } = await params;

  const sessionUserId = (authResult.session.user as { id?: string }).id;
  if (id === sessionUserId) {
    return apiError("Cannot delete your own account", 403);
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { email: true, name: true, role: true, isActive: true, mustChangePassword: true },
  });
  if (!user) return apiError("User not found", 404);

  if (user.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      return apiError("Cannot delete the last admin", 403);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } });
      // The row is gone, so the audit entry keeps who it was.
      await recordUserDeleted(tx, { actor: actorFromSession(authResult.session), ipAddress: requestIp(req) }, id, user);
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("User not found", 404);
    }
    throw error;
  }
  return apiSuccess({ ok: true });
});
