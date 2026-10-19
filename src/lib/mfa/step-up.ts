import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMfaEnabled } from "@/lib/mfa/service";

/**
 * Step-up: a signed-in session must have passed a second-factor check in the
 * last few minutes to do something dangerous (approve or void an invoice,
 * reverse a journal, reopen the books, change bank details, change who has
 * access). Signing in with a code counts; otherwise the page asks for a fresh
 * one. This is what makes a stolen session — cookie lifted, laptop left open —
 * unable to move money or hand itself more access.
 *
 * Tracked per session (the token's `sid`), in the database, because a JWT
 * can't be re-issued from an API route.
 *
 * A user with no second factor is not asked: there is nothing to ask with.
 * Enforcement (MFA_REQUIRED_ROLES) is what makes sure the people who can reach
 * these actions have one.
 */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;
/** Old rows are swept when a new one is written. */
const KEEP_ROWS_FOR_MS = 24 * 60 * 60 * 1000;

export const STEP_UP_REQUIRED_CODE = "step_up_required";

/** Whether a check made at `verifiedAt` still counts at `now`. */
export function stepUpFresh(verifiedAt: Date | null | undefined, now: number): boolean {
  if (!verifiedAt) return false;
  const age = now - verifiedAt.getTime();
  // A timestamp from the future is not "fresh", it is wrong.
  return age >= 0 && age <= STEP_UP_WINDOW_MS;
}

type Db = Pick<Prisma.TransactionClient, "stepUpVerification">;

export async function recordStepUp(db: Db, userId: string, sessionId: string, now = Date.now()): Promise<void> {
  const verifiedAt = new Date(now);
  await db.stepUpVerification.upsert({
    where: { sessionId },
    update: { userId, verifiedAt },
    create: { sessionId, userId, verifiedAt },
  });
  await db.stepUpVerification.deleteMany({ where: { verifiedAt: { lt: new Date(now - KEEP_ROWS_FOR_MS) } } });
}

export async function isStepUpFresh(db: Db, userId: string, sessionId: string | undefined, now = Date.now()): Promise<boolean> {
  if (!sessionId) return false;
  const row = await db.stepUpVerification.findUnique({ where: { sessionId } });
  // The row must belong to this user: a session id is not a bearer secret.
  return row !== null && row.userId === userId && stepUpFresh(row.verifiedAt, now);
}

/**
 * The guard routes call for a dangerous action: null to carry on, or the
 * response to return. The client turns `step_up_required` into a prompt for a
 * code and retries.
 */
export async function stepUpGuard(session: Session): Promise<NextResponse | null> {
  const user = session.user as { id?: string; sid?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { totpSecretEnc: true, totpEnabledAt: true },
  });
  if (!row || !isMfaEnabled(row)) return null; // nothing to confirm with

  if (await isStepUpFresh(prisma, user.id, user.sid)) return null;
  return NextResponse.json(
    { error: "Confirm with your authenticator code to continue", code: STEP_UP_REQUIRED_CODE },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}
