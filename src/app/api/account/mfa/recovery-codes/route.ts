export const dynamic = "force-dynamic";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isMfaLocked, recordMfaFailure, clearMfaFailures } from "@/lib/auth";
import { withErrorHandler } from "@/lib/api-errors";
import { json, mfaError, requireAccount } from "@/lib/mfa/api";
import { regenerateRecoveryCodes, verifySecondFactor } from "@/lib/mfa/service";

const body = z.object({ code: z.string().regex(/^\s*\d{3}\s*\d{3}\s*$/, "Enter the 6-digit code from your authenticator app") });

/**
 * Replaces the recovery codes (every old one stops working). Needs a current
 * authenticator code — not a recovery code, or one stolen code could mint more —
 * and wrong guesses count toward the same second-step lock as signing in.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const account = await requireAccount(req);
  if (!account.ok) return account.response;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
  if (await isMfaLocked(account.email)) {
    return json({ error: "Too many wrong codes. Try again in 15 minutes." }, 429);
  }

  try {
    const codes = await prisma.$transaction(async (tx) => {
      const result = await verifySecondFactor(tx, account.userId, parsed.data.code, account.audit);
      if (!result.ok) return null;
      return regenerateRecoveryCodes(tx, account.userId, account.audit);
    });
    if (!codes) {
      await recordMfaFailure(account.email);
      return json({ error: "That code isn't right. Wait for the next one and try again." }, 400);
    }
    await clearMfaFailures(account.email);
    return json({ recoveryCodes: codes });
  } catch (error) {
    return mfaError(error);
  }
});
