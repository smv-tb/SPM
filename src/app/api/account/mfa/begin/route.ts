export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { json, mfaError, requireAccount } from "@/lib/mfa/api";
import { beginEnrolment } from "@/lib/mfa/service";

/**
 * Starts enrolment: a fresh secret (stored encrypted, not yet live) returned
 * once so the page can draw the QR code. Calling it again restarts with a new
 * secret, so abandoning a half-finished setup leaves nothing behind.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const account = await requireAccount(req, { allowPendingMfaSetup: true });
  if (!account.ok) return account.response;
  try {
    return json(await prisma.$transaction((tx) => beginEnrolment(tx, account.userId)));
  } catch (error) {
    return mfaError(error);
  }
});
