import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { hasPermission, roleHasPermission, PERMISSIONS } from "@/lib/permissions";

const session = (user: Record<string, unknown>) =>
  ({ user, expires: "2099-01-01" }) as unknown as Session;

describe("roleHasPermission", () => {
  it("grants by rank", () => {
    expect(roleHasPermission("ADMIN", "books:close")).toBe(true);
    expect(roleHasPermission("PM", "books:close")).toBe(false);
    expect(roleHasPermission("PM", "books:post")).toBe(true);
    expect(roleHasPermission("CONTRIBUTOR", "books:view")).toBe(false);
    expect(roleHasPermission("CONTRIBUTOR", "funding:delete")).toBe(false);
    expect(roleHasPermission("PM", "funding:delete")).toBe(true);
    expect(roleHasPermission("VIEWER", "funding:sync")).toBe(false);
    expect(roleHasPermission("CONTRIBUTOR", "funding:sync")).toBe(false);
    expect(roleHasPermission("PM", "funding:sync")).toBe(true);
  });

  it("keeps the everyday and user-management capabilities where the old role checks had them", () => {
    for (const perm of ["funding:edit", "work:edit", "categories:edit", "users:list"] as const) {
      expect(roleHasPermission("CONTRIBUTOR", perm)).toBe(true);
    }
    expect(roleHasPermission("PM", "users:manage")).toBe(false);
    expect(roleHasPermission("ADMIN", "users:manage")).toBe(true);
    expect(roleHasPermission("CONTRIBUTOR", "users:emails")).toBe(false);
    expect(roleHasPermission("PM", "users:emails")).toBe(true);
  });

  it("denies unknown, missing or prototype-key roles", () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(roleHasPermission(undefined, permission)).toBe(false);
      expect(roleHasPermission("SUPERUSER", permission)).toBe(false);
      expect(roleHasPermission("toString", permission)).toBe(false);
    }
  });

  it("gives VIEWER no finance capabilities", () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(roleHasPermission("VIEWER", permission)).toBe(false);
    }
  });
});

describe("hasPermission", () => {
  it("requires an authenticated user id", () => {
    expect(hasPermission(null, "books:view")).toBe(false);
    expect(hasPermission(session({ role: "ADMIN" }), "books:view")).toBe(false);
    expect(hasPermission(session({ id: 7, role: "ADMIN" }), "books:view")).toBe(false);
    expect(hasPermission(session({ id: "u1", role: "ADMIN" }), "books:view")).toBe(true);
  });
});
