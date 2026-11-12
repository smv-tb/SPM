import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  diffFields, diffIdSet, pickFields, parseFields, resolveOwner,
  parsePagination, paginateResponse, clampPercent, toDate, safeNumber,
} from "@/hermes/tools/_shared";
import { MAX_PAGE_LIMIT } from "@/lib/constants";
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

describe("pagination", () => {
  it("asks for one extra row so it can tell there is a next page", () => {
    expect(parsePagination({ limit: 10 })).toEqual({ take: 11, cursor: undefined, skip: 0 });
    expect(parsePagination({ limit: 10, cursor: "x" })).toEqual({ take: 11, cursor: { id: "x" }, skip: 1 });
  });

  it("never exceeds the page cap", () => {
    expect(parsePagination({ limit: 1e6 }).take).toBe(MAX_PAGE_LIMIT + 1);
  });

  it("trims the extra row and returns its predecessor as the cursor", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(paginateResponse(rows, 2)).toEqual({ data: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
    expect(paginateResponse(rows, 3)).toEqual({ data: rows, nextCursor: null });
  });
});

describe("value helpers", () => {
  it("clamps percentages to 0-100", () => {
    expect([clampPercent(-5), clampPercent(42), clampPercent(250)]).toEqual([0, 42, 100]);
  });

  it("turns a calendar string into a Date and leaves undefined alone", () => {
    expect(toDate("2026-03-01")).toEqual(new Date("2026-03-01"));
    expect(toDate(undefined)).toBeUndefined();
  });

  it("keeps null (clear the field) distinct from a bad number (ignore it)", () => {
    expect(safeNumber(null)).toBeNull();
    expect(safeNumber(undefined)).toBeUndefined();
    expect(safeNumber("abc")).toBeUndefined();
    expect(safeNumber("12.5")).toBe(12.5);
  });
});
