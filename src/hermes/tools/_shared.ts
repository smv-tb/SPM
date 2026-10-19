import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/constants";

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export function parsePagination(args: Record<string, unknown> | undefined): {
  take: number;
  cursor?: { id: string };
  skip?: number;
} {
  const limit = Math.min(
    parseInt(String(args?.limit ?? DEFAULT_PAGE_LIMIT)),
    MAX_PAGE_LIMIT
  );
  const cursor = args?.cursor ? String(args.cursor) : undefined;
  return {
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
  };
}

export function paginateResponse<T extends { id: string }>(
  items: T[],
  limit: number
): { data: T[]; nextCursor: string | null } {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, -1) : items;
  const nextCursor = hasMore ? data[data.length - 1]?.id : null;
  return { data, nextCursor };
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Task/milestone startDate/dueDate are validated with z.string().date(),
 * which yields a plain "YYYY-MM-DD" string, not a Date — Prisma needs an
 * actual Date object or the value silently fails to persist correctly.
 * (See the same conversion in src/app/api/tasks/[id]/route.ts.)
 */
export function toDate(value: string | Date | undefined): Date | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? value : new Date(value);
}

export function safeNumber(value: unknown): number | undefined | null {
  if (value === null || value === undefined) return value as undefined | null;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export const standardIncludes = {
  milestone: { select: { id: true, code: true, title: true } },
  taskTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
  taskAssignments: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  resource: { select: { id: true, name: true } },
} as const;

// ─── Tool-schema fragments ──────────────────────────────────────────────────

export const DATE_PROP = {
  type: "string",
  description: "Calendar date, YYYY-MM-DD. A full ISO timestamp (as returned by reads) is also accepted; its date part is used.",
} as const;

export const TASK_STATUS_PROP = { type: "string", enum: ["BACKLOG", "IN_PROGRESS", "DONE", "BLOCKED", "ON_HOLD", "OVERDUE"] } as const;
export const MILESTONE_STATUS_PROP = { type: "string", enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "BLOCKED", "ON_HOLD"] } as const;
export const PRIORITY_PROP = { type: "string", enum: ["HIGH", "MED", "LOW"] } as const;

export const LIST_SHAPE_PROPS = {
  fields: {
    type: "array",
    items: { type: "string" },
    description: "Sparse fieldset: return only these top-level fields per row (id is always included).",
  },
  summary: {
    type: "boolean",
    description: "Compact rows with no nested relations. Much smaller than the default full rows.",
  },
} as const;

export const PATCH_NOTE =
  "Partial update: only the fields present in the payload are written; omitted fields keep their current value. " +
  "Returns the updated record plus `changes` ({ field: { from, to } }) listing exactly what changed.";

/** Upper bound on items in any bulk tool, so one call cannot hold a transaction open indefinitely. */
export const MAX_BULK_ITEMS = 200;

// ─── Sparse fieldsets ───────────────────────────────────────────────────────

export function parseFields(args: Record<string, unknown>): string[] | null {
  const raw = args.fields;
  if (raw === undefined || raw === null) return null;
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  const fields = list.map((f) => String(f).trim()).filter(Boolean);
  return fields.length > 0 ? fields : null;
}

export function pickFields<T extends Record<string, unknown>>(row: T, fields: string[] | null): Record<string, unknown> {
  if (!fields) return row;
  const out: Record<string, unknown> = { id: row.id };
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

// ─── Changed-field diffs ────────────────────────────────────────────────────

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

function isDecimalLike(value: object): value is { toNumber(): number } {
  return "s" in value && "e" in value && "d" in value && typeof (value as { toNumber?: unknown }).toNumber === "function";
}

function normalizeScalar(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object" && isDecimalLike(value)) return value.toNumber();
  return value;
}

function isComparable(value: unknown): boolean {
  if (value === null || value === undefined || value instanceof Date) return true;
  if (typeof value !== "object") return true;
  return isDecimalLike(value);
}

/**
 * The scalar columns that differ between two versions of a row. Relations
 * (nested objects/arrays) are skipped — callers add those explicitly, e.g. as
 * `tagIds`. `updatedAt` is noise and always left out.
 */
export function diffFields(before: object, after: object, ignore: string[] = ["updatedAt"]): FieldChanges {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const changes: FieldChanges = {};
  for (const key of Object.keys(a)) {
    if (ignore.includes(key) || !(key in b)) continue;
    if (!isComparable(a[key]) || !isComparable(b[key])) continue;
    const from = normalizeScalar(b[key]);
    const to = normalizeScalar(a[key]);
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}

/** Adds an id-set change (tags, owners…) when the membership actually differs. */
export function diffIdSet(changes: FieldChanges, key: string, before: string[], after: string[] | undefined): void {
  if (after === undefined) return;
  const from = [...before].sort();
  const to = [...new Set(after)].sort();
  if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
}

export function withChanges<T extends object>(record: T, changes: FieldChanges): T & { changes: FieldChanges } {
  return { ...record, changes };
}

// ─── Owners ─────────────────────────────────────────────────────────────────

interface OwnableTask {
  resourceId?: string | null;
  resource?: { id: string; name: string } | null;
  taskAssignments?: { role: string; user: { id: string; name: string | null } }[];
}

/**
 * A task's owner can live in two places: `resourceId` (a Resource row — a
 * team member or partner) and `taskAssignments` with role OWNER (a User). A
 * null `resourceId` does not mean unassigned. Resolved in the same order the
 * Tasks screen uses: resource, then OWNER assignment, then any assignee.
 */
export function resolveOwner(task: OwnableTask) {
  const assignments = task.taskAssignments ?? [];
  const owners = assignments.filter((a) => a.role === "OWNER").map((a) => ({ userId: a.user.id, name: a.user.name }));
  const collaborators = assignments.filter((a) => a.role !== "OWNER").map((a) => ({ userId: a.user.id, name: a.user.name }));
  let owner: { name: string | null; source: "resource" | "assignment" | "collaborator"; id: string } | null = null;
  if (task.resource) owner = { name: task.resource.name, source: "resource", id: task.resource.id };
  else if (owners[0]) owner = { name: owners[0].name, source: "assignment", id: owners[0].userId };
  else if (collaborators[0]) owner = { name: collaborators[0].name, source: "collaborator", id: collaborators[0].userId };
  return { owner, owners, collaborators, unassigned: owner === null };
}
