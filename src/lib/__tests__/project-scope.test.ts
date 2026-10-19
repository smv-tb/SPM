import { describe, it, expect } from "vitest";
import { ALL_PROJECTS, chooseScope, isProjectArchivedError, projectWhere } from "@/lib/project-scope";
import { canDelete } from "@/lib/projects";
import { combineProjectBasis, computeCashPosition } from "@/lib/funding";

const active = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("chooseScope", () => {
  it("has nothing to choose when there is no active project", () => {
    expect(chooseScope({ active: [], cookie: "a", defaultProjectId: "a" })).toEqual({ kind: "none" });
  });

  it("prefers an explicit request, then the cookie, then the default, then the oldest", () => {
    expect(chooseScope({ active, requested: "c", cookie: "b", defaultProjectId: "a" })).toEqual({ kind: "project", projectId: "c" });
    expect(chooseScope({ active, cookie: "b", defaultProjectId: "c" })).toEqual({ kind: "project", projectId: "b" });
    expect(chooseScope({ active, defaultProjectId: "c" })).toEqual({ kind: "project", projectId: "c" });
    expect(chooseScope({ active })).toEqual({ kind: "project", projectId: "a" });
  });

  it("ignores a cookie or request for a project that is not active (archived, deleted, forged)", () => {
    expect(chooseScope({ active, requested: "zzz", cookie: "archived", defaultProjectId: "b" })).toEqual({ kind: "project", projectId: "b" });
  });

  it("ignores a default project that has since been archived", () => {
    expect(chooseScope({ active, defaultProjectId: "gone" })).toEqual({ kind: "project", projectId: "a" });
  });

  it("only honours 'all' where the portfolio view is allowed", () => {
    expect(chooseScope({ active, cookie: ALL_PROJECTS, allowAll: true })).toEqual({ kind: "all" });
    expect(chooseScope({ active, cookie: ALL_PROJECTS, defaultProjectId: "b" })).toEqual({ kind: "project", projectId: "b" });
  });
});

describe("projectWhere", () => {
  it("filters to one project or to the active ones", () => {
    expect(projectWhere({ kind: "project", projectId: "a" })).toEqual({ projectId: "a" });
    expect(projectWhere({ kind: "all", projectIds: ["a", "b"] })).toEqual({ projectId: { in: ["a", "b"] } });
  });
});

describe("combineProjectBasis", () => {
  it("takes the earliest start and sums historical spend to the penny", () => {
    const basis = combineProjectBasis([
      { startDate: new Date("2025-03-01"), historicalSpend: "0.10" },
      { startDate: null, historicalSpend: "0.20" },
      { startDate: new Date("2024-11-15"), historicalSpend: null },
    ]);
    expect(basis.startDate).toEqual(new Date("2024-11-15"));
    expect(basis.historicalSpend).toBe(0.3);
  });

  it("has no start date when no project has one", () => {
    expect(combineProjectBasis([])).toEqual({ startDate: null, historicalSpend: 0 });
  });
});

describe("portfolio cash position", () => {
  it("equals the per-project figures added up", () => {
    const rec = (amount: number, section: string, tranches: { amount: number; status: string; direction: string }[] = []) =>
      ({ amount, section, verified: true, tranches }) as unknown as Parameters<typeof computeCashPosition>[0][number];
    const a = [rec(1000, "LIVE"), rec(500, "FOUNDER", [{ amount: 200, status: "RECEIVED", direction: "INCOMING" }, { amount: 300, status: "PENDING", direction: "INCOMING" }])];
    const b = [rec(250, "LIVE", [{ amount: 100, status: "RECEIVED", direction: "OUTGOING" }])];
    const all = computeCashPosition([...a, ...b]);
    const pa = computeCashPosition(a);
    const pb = computeCashPosition(b);
    expect(all.securedCash).toBeCloseTo(pa.securedCash + pb.securedCash);
    expect(all.bankedCash).toBeCloseTo(pa.bankedCash + pb.bankedCash);
    expect(all.repaidOutflows).toBeCloseTo(pa.repaidOutflows + pb.repaidOutflows);
  });
});

describe("isProjectArchivedError", () => {
  it("recognises the trigger's refusal however the driver wraps it", () => {
    expect(isProjectArchivedError(new Error("PROJECT_ARCHIVED: tasks belongs to an archived project"))).toBe(true);
    expect(isProjectArchivedError({ code: "P2010", meta: { message: "ERROR: PROJECT_ARCHIVED: tasks …" } })).toBe(true);
    expect(isProjectArchivedError(new Error("outer", { cause: new Error("PROJECT_ARCHIVED: x") }))).toBe(true);
  });

  it("leaves every other error alone", () => {
    expect(isProjectArchivedError(new Error("unique constraint"))).toBe(false);
    expect(isProjectArchivedError(null)).toBe(false);
  });
});

describe("canDelete", () => {
  const none = { fundingRecords: 0, cashTransactions: 0, tasksWithSpend: 0, livingLabCostsWithSpend: 0, bookEntries: 0 };
  it("allows only a project that never held money", () => {
    expect(canDelete(none)).toBe(true);
    for (const key of Object.keys(none) as (keyof typeof none)[]) {
      expect(canDelete({ ...none, [key]: 1 })).toBe(false);
    }
  });
});
