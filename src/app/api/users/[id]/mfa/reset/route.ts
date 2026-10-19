export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, apiError, apiSuccess, withErrorHandler } from "@/lib/api-errors";
import { actorFromSession, requestIp } from "@/lib/audit";
import { disableMfa, isMfaEnabled } from "@/lib/mfa/service";
import { stepUpGuard } from "@/lib/mfa/step-up";
import { alertInBackground } from "@/lib/security-alerts";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().trim().min(3, "Say why (at least a few words)").max(500) });

/**
 * An administrator switches off someone else's second factor — a lost or
 * replaced phone. The user's recovery codes are deleted, every one of their
 * sessions ends, and the reason is kept in the audit log. They can sign in
 * with their password alone and set it up again.
 *
 * Not available on yourself: an account that could drop its own second step
 * would give a stolen admin session a way to remove it. Another administrator
 * does it; if there is only one, see docs/security/RESET-MFA.md.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;

  const { id } = await params;
  if (id === (authResult.session.user as { id?: string }).id) {
    return apiError("You can't reset your own two-factor sign-in. Ask another administrator.", 400);
  }

  const refusal = await stepUpGuard(authResult.session);
  if (refusal) return refusal;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const user = await prisma.user.findUnique({
    where: { id },
    select: { email: true, totpSecretEnc: true, totpEnabledAt: true },
  });
  if (!user) return apiError("User not found", 404);
  if (!isMfaEnabled(user) && !user.totpSecretEnc) return apiError("Two-factor sign-in isn't set up for this user", 409);

  await prisma.$transaction((tx) =>
    disableMfa(tx, id, { actor: actorFromSession(authResult.session), ipAddress: requestIp(req) }, parsed.data.reason)
  );
  alertInBackground({
    event: "mfa.reset",
    summary: `Two-factor sign-in was switched off for ${user.email}`,
    actor: (authResult.session.user as { email?: string }).email ?? null,
    target: user.email,
    ipAddress: requestIp(req),
    details: { reason: parsed.data.reason },
  });
  return apiSuccess({ ok: true });
});
