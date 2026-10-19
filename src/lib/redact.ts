import type { Session } from "next-auth";
import { hasPermission } from "@/lib/permissions";

export function canSeeEmail(session: Session | null): boolean {
  return hasPermission(session, "users:emails");
}

export function sanitizeUser(
  user: Record<string, unknown> | null | undefined,
  session: Session | null
): Record<string, unknown> | null | undefined {
  if (!user) return user;
  if (canSeeEmail(session)) return user;
  // Remove email to prevent leaking to non-PM users
  return Object.fromEntries(
    Object.entries(user).filter(([key]) => key !== "email")
  );
}

/**
 * Sanitize an array of items that may have a top-level `user` property
 * (e.g. resources which have `resource.user`).
 */
export function sanitizeUsers<T extends Record<string, unknown>>(
  items: T[],
  session: Session | null
): T[] {
  if (canSeeEmail(session)) return items;
  return items.map((item) => {
    if (item.user && typeof item.user === "object") {
      return { ...item, user: sanitizeUser(item.user as Record<string, unknown>, session) };
    }
    return item;
  });
}

/**
 * Sanitize user emails nested inside `taskAssignments[].user`
 * (the shape returned by task queries).
 */
export function sanitizeTaskAssignments<T extends { taskAssignments?: Array<Record<string, unknown>> }>(
  items: T[],
  session: Session | null
): T[] {
  if (canSeeEmail(session)) return items;
  return items.map((item) => {
    if (!item.taskAssignments) return item;
    return {
      ...item,
      taskAssignments: item.taskAssignments.map((assignment) => {
        if (assignment.user && typeof assignment.user === "object") {
          return { ...assignment, user: sanitizeUser(assignment.user as Record<string, unknown>, session) };
        }
        return assignment;
      }),
    };
  });
}
