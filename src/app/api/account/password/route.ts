export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  authIncludingPendingSetup,
  isAccountLocked,
  recordAccountFailure,
  clearAccountFailures,
} from "@/lib/auth";
import { apiError, apiSuccess, withErrorHandler } from "@/lib/api-errors";
import { BCRYPT_ROUNDS } from "@/lib/constants";
import { passwordIssues } from "@/lib/password-policy";
import { newSecurityStamp } from "@/lib/session-validity";
import { actorFromSession, recordAudit, requestIp } from "@/lib/audit";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});

/**
 * A signed-in user changes their own password. This is one of only two places
 * a user who owes a password change (a temporary one set by an admin) is let
 * in; everywhere else `auth()` treats them as signed out.
 *
 * Needs the current password even though the caller is signed in, so a stolen
 * session can't be turned into a permanent takeover. Wrong guesses count
 * toward the same per-account lock as signing in. Success rotates the security
 * stamp, which ends every session including this one — the caller signs in
 * again with the new password.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await authIncludingPendingSetup();
  const sessionUser = session?.user as { id?: string; email?: string } | undefined;
  if (!sessionUser?.id) return apiError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Current and new password are required", 400);
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
  if (!user || !user.isActive || !user.password) return apiError("Unauthorized", 401);

  if (await isAccountLocked(user.email)) {
    return apiError("Too many wrong passwords. Try again in 15 minutes.", 429);
  }
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    await recordAccountFailure(user.email);
    return apiError("Current password is incorrect", 400);
  }

  const issues = passwordIssues(newPassword, { email: user.email, name: user.name });
  if (issues.length > 0) return apiError(issues[0], 400, { password: issues });
  if (newPassword === currentPassword) {
    return apiError("Choose a password different from your current one", 400);
  }

  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { password: hashed, mustChangePassword: false, securityStamp: newSecurityStamp() },
    });
    // The event only — never either password, nor the hash.
    await recordAudit(tx, {
      actor: actorFromSession(session!),
      action: "user.password_change",
      entityType: "User",
      entityId: user.id,
      before: { mustChangePassword: user.mustChangePassword },
      after: { mustChangePassword: false },
      ipAddress: requestIp(req),
    });
  });
  await clearAccountFailures(user.email);

  return apiSuccess({ ok: true });
});
