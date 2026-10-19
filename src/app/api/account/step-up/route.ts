export const dynamic = "force-dynamic";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isMfaLocked, recordMfaFailure, clearMfaFailures } from "@/lib/auth";
import { withErrorHandler } from "@/lib/api-errors";
import { recordAudit } from "@/lib/audit";
import { json, mfaError, requireAccount } from "@/lib/mfa/api";
import { isMfaEnabled, verifySecondFactor } from "@/lib/mfa/service";
import { recordStepUp, STEP_UP_WINDOW_MS } from "@/lib/mfa/step-up";

const body = z.object({
  code: z.string().regex(/^\s*\d{3}\s*\d{3}\s*$/, "Enter the 6-digit code from your authenticator app"),
});

/**
 * Confirms this session with a fresh authenticator code, unlocking dangerous
 * actions for a few minutes (see src/lib/mfa/step-up.ts).
 *
 * Authenticator codes only: a recovery code is for signing in when the phone is
 * gone, and signing in with one already counts as a check. Wrong codes go to the
 * same hour-long second-step lock as signing in.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const account = await requireAccount(req);
  if (!account.ok) return account.response;

  // Sessions issued before step-up existed have no id to attach the proof to.
  if (!account.sessionId) {
    return json({ error: "Please sign out and sign in again to continue.", code: "signin_required" }, 409);
  }

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);

  if (await isMfaLocked(account.email)) {
    return json({ error: "Too many wrong codes. Try again later." }, 429);
  }

  try {
    const ok = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: account.userId },
        select: { totpSecretEnc: true, totpEnabledAt: true },
      });
      if (!user || !isMfaEnabled(user)) return null;
      const result = await verifySecondFactor(tx, account.userId, parsed.data.code, account.audit);
      if (!result.ok) return false;
      await recordStepUp(tx, account.userId, account.sessionId!);
      await recordAudit(tx, {
        actor: account.audit.actor,
        action: "mfa.step_up",
        entityType: "User",
        entityId: account.userId,
        ipAddress: account.audit.ipAddress,
      });
      return true;
    });

    if (ok === null) return json({ error: "Two-factor sign-in isn't set up for this account." }, 409);
    if (!ok) {
      await recordMfaFailure(account.email);
      return json({ error: "That code isn't right. Wait for the next one and try again." }, 400);
    }
    await clearMfaFailures(account.email);
    return json({ ok: true, validForSeconds: STEP_UP_WINDOW_MS / 1000 });
  } catch (error) {
    return mfaError(error);
  }
});
