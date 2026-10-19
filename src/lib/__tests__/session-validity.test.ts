import { describe, it, expect } from "vitest";
import { sessionStillValid, newSecurityStamp, changeEndsSessions, resetRequiresChange } from "@/lib/session-validity";

const user = { role: "PM", isActive: true, securityStamp: "stamp-1" };

describe("sessionStillValid", () => {
  it("accepts an active user whose stamp matches", () => {
    expect(sessionStillValid("stamp-1", user)).toBe(true);
  });

  it("refuses a deleted user", () => {
    expect(sessionStillValid("stamp-1", null)).toBe(false);
  });

  it("refuses a deactivated user even with a matching stamp", () => {
    expect(sessionStillValid("stamp-1", { ...user, isActive: false })).toBe(false);
  });

  it("refuses a token issued before the stamp changed", () => {
    expect(sessionStillValid("stamp-0", user)).toBe(false);
  });

  it("refuses a token with no stamp, however valid the user", () => {
    expect(sessionStillValid(undefined, user)).toBe(false);
    expect(sessionStillValid("", user)).toBe(false);
    expect(sessionStillValid(123, user)).toBe(false);
  });
});

describe("newSecurityStamp", () => {
  it("is different every time", () => {
    expect(newSecurityStamp()).not.toBe(newSecurityStamp());
  });
});

describe("changeEndsSessions", () => {
  const before = { role: "PM", isActive: true };

  it("ends sessions when the role changes", () => {
    expect(changeEndsSessions(before, { role: "VIEWER" })).toBe(true);
  });

  it("ends sessions when the user is deactivated or reactivated", () => {
    expect(changeEndsSessions(before, { isActive: false })).toBe(true);
    expect(changeEndsSessions({ ...before, isActive: false }, { isActive: true })).toBe(true);
  });

  it("ends sessions when the password is set", () => {
    expect(changeEndsSessions(before, { password: "a-new-password" })).toBe(true);
  });

  it("leaves sessions alone for a no-op or a name change", () => {
    expect(changeEndsSessions(before, {})).toBe(false);
    expect(changeEndsSessions(before, { role: "PM", isActive: true })).toBe(false);
    expect(changeEndsSessions(before, { password: "" })).toBe(false);
    expect(changeEndsSessions(before, { password: null })).toBe(false);
  });
});

describe("resetRequiresChange", () => {
  it("makes someone else's new password temporary", () => {
    expect(resetRequiresChange("admin-1", "user-2")).toBe(true);
  });

  it("does not when you set your own", () => {
    expect(resetRequiresChange("admin-1", "admin-1")).toBe(false);
  });

  it("treats an unknown actor (the agent) as someone else", () => {
    expect(resetRequiresChange(undefined, "user-2")).toBe(true);
  });
});
