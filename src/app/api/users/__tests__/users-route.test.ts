import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * F-12: GET /api/users is open to Contributors (users:list), but email
 * addresses are PM+ (users:emails). Below that they are neither returned nor
 * searchable.
 */
const findMany = vi.fn();
let role = "CONTRIBUTOR";
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u-caller", role } }) }));

import { GET } from "@/app/api/users/route";

const ROWS = [
  { id: "u1", email: "alice@example.test", name: "Alice", role: "PM", avatarUrl: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), totpEnabledAt: null },
];

beforeEach(() => {
  findMany.mockReset();
  // Behave like Prisma: only selected fields come back.
  findMany.mockImplementation(async ({ select }: { select: Record<string, boolean> }) =>
    ROWS.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => select[k])))
  );
});

const call = async (qs = "") => {
  const res = await GET(new NextRequest(`http://localhost/api/users${qs}`), {});
  return { status: res.status, body: await res.json() };
};

describe("GET /api/users email exposure (F-12)", () => {
  it("gives a Contributor no email addresses", async () => {
    role = "CONTRIBUTOR";
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(findMany.mock.calls[0][0].select.email).toBe(false);
    expect(JSON.stringify(body.data)).not.toContain("@");
    expect(body.data[0].email).toBeNull();
  });

  it("does not let a Contributor search on email", async () => {
    role = "CONTRIBUTOR";
    await call("?search=alice%40");
    const or = findMany.mock.calls[0][0].where.OR as Record<string, unknown>[];
    expect(or.some((c) => "email" in c)).toBe(false);
    expect(or.some((c) => "name" in c)).toBe(true);
  });

  it("still gives a PM addresses and email search", async () => {
    role = "PM";
    const { body } = await call("?search=alice");
    expect(body.data[0].email).toBe("alice@example.test");
    const or = findMany.mock.calls[0][0].where.OR as Record<string, unknown>[];
    expect(or.some((c) => "email" in c)).toBe(true);
  });
});
