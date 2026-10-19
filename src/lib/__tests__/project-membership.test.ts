import { describe, it, expect } from "vitest";
import {
  assertProjectRole, effectiveRole, lowerRole, ProjectAccessError, isProjectAccessError, MEMBER_ROLES, type Role,
} from "@/lib/project-membership";

const members = (entries: [string, Role][]) => new Map(entries);

describe("effectiveRole", () => {
  it("admins reach every project, member or not", () => {
    expect(effectiveRole("ADMIN", "p1", members([]))).toBe("ADMIN");
  });

  it("everyone else reaches only the projects they belong to", () => {
    const m = members([["p1", "CONTRIBUTOR"]]);
    expect(effectiveRole("CONTRIBUTOR", "p1", m)).toBe("CONTRIBUTOR");
    expect(effectiveRole("CONTRIBUTOR", "p2", m)).toBeNull();
    expect(effectiveRole("PM", "p2", members([]))).toBeNull();
  });

  it("is the lower of the account role and the membership role: a membership narrows, never promotes", () => {
    expect(effectiveRole("PM", "p1", members([["p1", "VIEWER"]]))).toBe("VIEWER");
    expect(effectiveRole("CONTRIBUTOR", "p1", members([["p1", "PM"]]))).toBe("CONTRIBUTOR");
    expect(lowerRole("PM", "PM")).toBe("PM");
  });

  it("gives nothing to an unknown or missing account role", () => {
    for (const role of [undefined, null, "", "SUPERUSER", "toString", 3]) {
      expect(effectiveRole(role, "p1", members([["p1", "PM"]]))).toBeNull();
    }
  });
});

describe("assertProjectRole", () => {
  const m = members([["p1", "CONTRIBUTOR"], ["p2", "VIEWER"]]);

  it("passes for a member who has the capability in that project", () => {
    expect(assertProjectRole("PM", "p1", m, "work:edit")).toBe("CONTRIBUTOR");
    expect(assertProjectRole("CONTRIBUTOR", "p1", m)).toBe("CONTRIBUTOR");
  });

  it("answers not-found (404) for a project the person is not in, whatever the capability", () => {
    try {
      assertProjectRole("PM", "p9", m, "work:edit");
      expect.unreachable();
    } catch (error) {
      expect(isProjectAccessError(error)).toBe(true);
      expect((error as ProjectAccessError).status).toBe(404);
      expect((error as ProjectAccessError).message).toBe("Not found");
    }
  });

  it("answers forbidden (403) for a member whose role there is too low", () => {
    try {
      assertProjectRole("PM", "p2", m, "work:edit"); // a PM account, but only a viewer here
      expect.unreachable();
    } catch (error) {
      expect((error as ProjectAccessError).status).toBe(403);
    }
    // PM-only capabilities are out of reach of a contributor member even with a PM account
    expect(() => assertProjectRole("PM", "p1", m, "project:edit")).toThrow(ProjectAccessError);
  });

  it("lets a viewer member read but not change", () => {
    expect(assertProjectRole("PM", "p2", m)).toBe("VIEWER");
    expect(() => assertProjectRole("PM", "p2", m, "funding:edit")).toThrow(ProjectAccessError);
  });

  it("admins pass everything, including capabilities in projects they were never added to", () => {
    expect(assertProjectRole("ADMIN", "p9", members([]), "project:delete")).toBe("ADMIN");
  });
});

describe("member roles", () => {
  it("never include admin: that comes from the account", () => {
    expect([...MEMBER_ROLES]).toEqual(["PM", "CONTRIBUTOR", "VIEWER"]);
  });
});
