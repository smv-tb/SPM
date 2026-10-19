import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { logRequestError } from "@/lib/log";
import { isProjectAccessError } from "@/lib/project-membership";
import { isProjectArchivedError, PROJECT_ARCHIVED_MESSAGE } from "@/lib/project-scope";

/**
 * Standardized API error response.
 * Returns generic message to client; always log detailed errors server-side.
 */
export function apiError(
  message: string,
  status: number = 500,
  details?: Record<string, unknown>
) {
  const body: Record<string, unknown> = { error: message };
  if (details && process.env.NODE_ENV !== "production") {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}

/**
 * Standardized API success response.
 */
export function apiSuccess<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status });
}

/**
 * A failure caught by `withErrorHandler`. Carries the id it was logged under,
 * in the body and the `X-Error-Id` header, in every environment; the error's
 * own text only outside production, same rule as `apiError`.
 */
function routeFailure(message: string, status: number, errorId: string, debugMessage?: string) {
  const body: Record<string, unknown> = { error: message, errorId };
  if (debugMessage && process.env.NODE_ENV !== "production") {
    body.details = { debugMessage };
  }
  return NextResponse.json(body, { status, headers: { "X-Error-Id": errorId } });
}

/**
 * Wraps a route handler in try/catch with standardized error responses.
 * Logs full error details server-side (never exposes them to the client in
 * production) and returns a generic 500 message.
 * Supports Next.js route handlers with `(request, context)` signature.
 */
type RouteHandler = (...args: any[]) => Promise<NextResponse>;

export function withErrorHandler(
  handler: RouteHandler
): RouteHandler {
  return async function (this: unknown, ...args: any[]) {
    const req = args[0] as Request;
    try {
      return await handler.apply(this, args);
    } catch (error) {
      const errorId = randomUUID();
      if (isProjectAccessError(error)) {
        // Expected outcome of a guard, not a failure: no error id, no log line.
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      logRequestError(errorId, req, error);
      if (isProjectArchivedError(error)) {
        return NextResponse.json({ error: PROJECT_ARCHIVED_MESSAGE, code: "project_archived" }, { status: 409 });
      }
      const err = error as { code?: string; message?: string };
      const message = err?.message ?? "";
      if (
        err?.code === "P2022" ||
        message.includes("Unknown field") ||
        message.includes("The column")
      ) {
        return routeFailure("Database migration pending. Please run Prisma migrations.", 503, errorId);
      }
      const debugMessage =
        error instanceof Error ? error.message : "Internal server error";
      return routeFailure("Internal server error", 500, errorId, debugMessage);
    }
  };
}

/**
 * Require authentication — returns session or 401.
 */
export function requireAuth(session: Session | null): session is Session {
  if (!session?.user) return false;
  return typeof (session.user as { id?: unknown }).id === "string";
}

/**
 * Helper for route handlers: enforces the `users:manage` capability and returns
 * the session, or sends a 401/403 response.
 */
export async function requireAdmin(): Promise<
  { success: true; session: Session } | { success: false; response: NextResponse }
> {
  const session = await auth();
  if (!requireAuth(session)) {
    return { success: false, response: apiError("Unauthorized", 401) };
  }
  if (!hasPermission(session, "users:manage")) {
    return { success: false, response: apiError("Forbidden", 403) };
  }
  return { success: true, session };
}
