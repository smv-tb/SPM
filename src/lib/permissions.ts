import type { Session } from "next-auth";

/**
 * Finance capabilities.
 *
 * Roles alone are too coarse for the books: a CONTRIBUTOR logs task spend but
 * should not be able to post journals or delete funding history, and only an
 * ADMIN should close or reopen a period. Routes ask for a capability, not a
 * role, so the mapping can change here without touching every handler.
 *
 * Kept free of runtime imports so it can be unit-tested and used client-side
 * to hide controls — the server check is still the one that counts.
 */

type Role = "ADMIN" | "PM" | "CONTRIBUTOR" | "VIEWER";

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  CONTRIBUTOR: 1,
  PM: 2,
  ADMIN: 3,
};

export const PERMISSIONS = {
  /** Destroying funding history. Everyday edits stay at CONTRIBUTOR. */
  "funding:delete": "PM",
  /** Create or change funding records, tranches and pipeline stages. */
  "funding:edit": "CONTRIBUTOR",
  /** Everyday project work: tasks, milestones, resources, living labs and their costs, custom field values. */
  "work:edit": "CONTRIBUTOR",
  /** Cost categories (company-wide). */
  "categories:edit": "CONTRIBUTOR",
  /** See the team list (names, emails, roles) to assign work. */
  "users:list": "CONTRIBUTOR",
  /** See other users' email addresses. */
  "users:emails": "PM",
  /** Create, change, deactivate and delete users; reset their second factor. */
  "users:manage": "ADMIN",
  /** Rebuild the derived cash ledger from source records. */
  "funding:sync": "PM",
  /** Read ledgers, reports, contacts. */
  "books:view": "PM",
  /** Create/post journals, invoices, bills; import and reconcile statements. */
  "books:post": "PM",
  /** Approve documents that allocate a legal number (invoices, credit notes). */
  "books:approve": "ADMIN",
  /** Lock periods and close the financial year. */
  "books:close": "ADMIN",
  /** Reopen a locked period. Always audited with a reason. */
  "books:reopen": "ADMIN",
  /** Export everything held about a contact, and anonymise one past its retention period. */
  "books:privacy": "ADMIN",
  /** Company details, financial year and chart-of-accounts structure. */
  "books:settings": "ADMIN",
  /** Start a project. */
  "project:create": "PM",
  /** Project details: name, dates, logo, historical spend. */
  "project:edit": "PM",
  /** A project's structure: phases, tags and custom field definitions. */
  "project:structure": "CONTRIBUTOR",
  /** Archive or restore a project (it becomes read-only, data kept). */
  "project:archive": "PM",
  /** Who may open a project, and at what role (S2.7). Access control, so Admin only. */
  "project:members": "ADMIN",
  /** Delete a project outright — only one that never held money. */
  "project:delete": "ADMIN",
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_RANK;
}

export function roleHasPermission(role: unknown, permission: Permission): boolean {
  // Unknown or missing roles get nothing — never default to access.
  if (!isRole(role)) return false;
  return ROLE_RANK[role] >= ROLE_RANK[PERMISSIONS[permission]];
}

export function hasPermission(session: Session | null, permission: Permission): boolean {
  const user = session?.user as { id?: unknown; role?: unknown } | undefined;
  if (typeof user?.id !== "string") return false;
  return roleHasPermission(user.role, permission);
}
