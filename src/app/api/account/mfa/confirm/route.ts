export const dynamic = "force-dynamic";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { json, mfaError, requireAccount } from "@/lib/mfa/api";
import { confirmEnrolment } from "@/lib/mfa/service";

const body = z.object({ code: z.string().min(1).max(32) });

/** Proves the authenticator works, turns two-factor on, and returns the recovery codes — the only time they can be read. */
export const POST = withErrorHandler(async (req: Request) => {
  const account = await requireAccount(req, { allowPendingMfaSetup: true });
  if (!account.ok) return account.response;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Enter the 6-digit code from your authenticator app" }, 400);

  try {
    return json(await prisma.$transaction((tx) => confirmEnrolment(tx, account.userId, parsed.data.code, account.audit)));
  } catch (error) {
    return mfaError(error);
  }
});
