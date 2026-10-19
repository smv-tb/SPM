export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { json, requireAccount } from "@/lib/mfa/api";
import { isMfaEnabled, recoveryCodesRemaining } from "@/lib/mfa/service";

/** Whether the signed-in user has a second factor, and how many recovery codes are left. Never the secret. */
export const GET = withErrorHandler(async (req: Request) => {
  const account = await requireAccount(req, { allowPendingMfaSetup: true });
  if (!account.ok) return account.response;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: account.userId },
    select: { totpSecretEnc: true, totpEnabledAt: true },
  });
  const enabled = isMfaEnabled(user);
  return json({
    enabled,
    enabledAt: enabled ? user.totpEnabledAt : null,
    recoveryCodesRemaining: enabled ? await recoveryCodesRemaining(prisma, account.userId) : 0,
  });
});
