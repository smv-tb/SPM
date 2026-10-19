import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { diffFields, diffIdSet, pickFields, parseFields, resolveOwner } from "@/hermes/tools/_shared";
import { normalizeCode, codePrefix } from "@/hermes/tools/general";

describe("diffFields", () => {
  it("reports only changed scalars, normalising Decimals and Dates", () => {
    const before = { id: "t", status: "IN_PROGRESS", actualSpend: new Prisma.Decimal("10.50"), dueDate: new Date("2026-01-01"), updatedAt: new Date(1) };
    const after = { id: "t", status: "IN_PROGRESS", actualSpend: new Prisma.Decimal("12"), dueDate: new Date("2026-01-01"), updatedAt: new Date(2) };
    expect(diffFields(before, after)).toEqual({ actualSpend: { from: 10.5, to: 12 } });
  });

  it("surfaces a silent reset", () => {
    expect(diffFields({ status: "DONE", percentDone: 100 }, { status: "BACKLOG", percentDone: 0 })).toEqual({
      status: { from: "DONE", to: "BACKLOG" },
      percentDone: { from: 100, to: 0 },
    });
  });

  it("skips relations", () => {
    expect(diffFields({ milestone: { code: "A" } }, { milestone: { code: "B" } })).toEqual({});
  });
});

describe("diffIdSet", () => {
  it("ignores order and absent sets", () => {
    const changes = {};
    diffIdSet(changes, "tagIds", ["a", "b"], ["b", "a"]);
    diffIdSet(changes, "ownerIds", ["a"], undefined);
    expect(changes).toEqual({});
    diffIdSet(changes, "tagIds", ["a"], ["a", "c"]);
    expect(changes).toEqual({ tagIds: { from: ["a"], to: ["a", "c"] } });
  });
});

describe("sparse fieldsets", () => {
  it("always keeps id", () => {
    expect(pickFields({ id: "1", a: 1, b: 2 }, ["b"])).toEqual({ id: "1", b: 2 });
    expect(parseFields({ fields: "a, b" })).toEqual(["a", "b"]);
    expect(parseFields({})).toBeNull();
  });
});

describe("resolveOwner", () => {
  const user = (id: string, name: string) => ({ id, name });

  it("treats an OWNER assignment as the owner when resourceId is null", () => {
    const r = resolveOwner({ resourceId: null, resource: null, taskAssignments: [{ role: "OWNER", user: user("u1", "Ada") }] });
    expect(r.owner).toEqual({ name: "Ada", source: "assignment", id: "u1" });
    expect(r.unassigned).toBe(false);
  });

  it("prefers the resource, like the Tasks screen", () => {
    const r = resolveOwner({ resourceId: "r1", resource: { id: "r1", name: "Partner Co" }, taskAssignments: [{ role: "OWNER", user: user("u1", "Ada") }] });
    expect(r.owner?.source).toBe("resource");
    expect(r.owners).toHaveLength(1);
  });

  it("is unassigned only when there is nobody", () => {
    expect(resolveOwner({ resourceId: null, resource: null, taskAssignments: [] }).unassigned).toBe(true);
  });
});

describe("search code helpers", () => {
  it("normalises punctuation", () => {
    expect(normalizeCode("M1.3-T01")).toBe(normalizeCode("m13 t01"));
  });

  it("extracts the milestone prefix of a task code", () => {
    expect(codePrefix("M1.3-T01")).toBe("M1.3");
    expect(codePrefix("M2-T4")).toBe("M2");
    expect(codePrefix("M1.3")).toBeNull();
  });
});
