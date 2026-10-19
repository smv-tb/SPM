import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";
import { actorFromSession, requestIp, type AuditActor } from "@/lib/audit";
import { stepUpGuard } from "@/lib/mfa/step-up";
import { AccountingError } from "@/lib/accounting/errors";

/**
 * Shared entry/exit plumbing for the /api/books routes: one place that decides
 * who may do what, and one place that turns a broken accounting rule into a
 * response. Keeps every handler down to validate → call service → serialize.
 */

export interface BooksContext {
  session: Session;
  actor: AuditActor;
  ipAddress: string | null;
}

type BooksGuard =
  | { ok: true; ctx: BooksContext }
  | { ok: false; response: NextResponse };

export interface BooksGuardOptions {
  /** A dangerous action: also needs a second-factor check in the last few minutes (src/lib/mfa/step-up.ts). */
  stepUp?: boolean;
}

export async function requireBooks(
  req: Request,
  permission: Permission,
  options: BooksGuardOptions = {}
): Promise<BooksGuard> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!hasPermission(session, permission)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (options.stepUp) {
    const refusal = await stepUpGuard(session);
    if (refusal) return { ok: false, response: refusal };
  }
  return {
    ok: true,
    ctx: { session, actor: actorFromSession(session), ipAddress: requestIp(req) },
  };
}

/**
 * Turns an AccountingError into its response, keeping the per-line problems so
 * the form can point at the offending row. Anything else is rethrown for
 * `withErrorHandler`, which logs it and returns a generic 500.
 */
export function booksError(error: unknown): NextResponse {
  if (error instanceof AccountingError) {
    return NextResponse.json(
      { error: error.message, code: error.code, problems: error.problems },
      { status: error.status }
    );
  }
  throw error;
}

export function invalidRequest(details: unknown): NextResponse {
  return NextResponse.json({ error: "Invalid request data", details }, { status: 400 });
}
