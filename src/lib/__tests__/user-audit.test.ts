import { describe, it, expect } from "vitest";
import { userChangeEvents, userSnapshot, type UserSnapshot } from "@/lib/user-audit";

const base: UserSnapshot = { email: "a@example.com", name: "A", role: "PM", isActive: true, mustChangePassword: false };
const events = (after: Partial<UserSnapshot>, passwordReset = false) =>
  userChangeEvents(base, { ...base, ...after }, { passwordReset });

describe("userChangeEvents", () => {
  it("is empty when nothing audit-worthy changed", () => {
    expect(events({})).toEqual([]);
  });

  it("records a role change on its own action, with from and to", () => {
    expect(events({ role: "ADMIN" })).toEqual([
      { action: "user.role_change", before: { role: "PM" }, after: { role: "ADMIN" } },
    ]);
  });

  it("separates deactivating from reactivating", () => {
    expect(events({ isActive: false })[0].action).toBe("user.deactivate");
    const reactivation = userChangeEvents({ ...base, isActive: false }, base, { passwordReset: false });
    expect(reactivation[0].action).toBe("user.activate");
  });

  it("records a password reset without any password material", () => {
    const [event] = events({ mustChangePassword: true }, true);
    expect(event.action).toBe("user.password_reset");
    expect(event.after).toEqual({ mustChangePassword: true });
    expect(JSON.stringify(event)).not.toMatch(/password"?:\s*"/i);
  });

  it("keeps the reset's outcome even when the flag was already set (an `after` alone is not diffed away)", () => {
    const already = { ...base, mustChangePassword: true };
    const [event] = userChangeEvents(already, already, { passwordReset: true });
    expect(event.action).toBe("user.password_reset");
    expect(event.before).toBeUndefined();
    expect(event.after).toEqual({ mustChangePassword: true });
  });

  it("records a name or email edit as an update", () => {
    expect(events({ name: "B" })[0]).toMatchObject({ action: "user.update", after: { name: "B", email: "a@example.com" } });
    expect(events({ email: "b@example.com" })[0].action).toBe("user.update");
  });

  it("splits one edit that does several things into one event each", () => {
    expect(events({ role: "VIEWER", isActive: false, name: "C" }, true).map((e) => e.action).sort()).toEqual(
      ["user.deactivate", "user.password_reset", "user.role_change", "user.update"]
    );
  });

  it("ignores a password sent in the same value (no reset happened)", () => {
    expect(events({}, false)).toEqual([]);
  });
});

describe("userSnapshot", () => {
  it("keeps only the audit-safe fields, whatever it is given", () => {
    const risky = { ...base, password: "$2a$12$hash", totpSecretEnc: "v1.k1.x.y.z", securityStamp: "s" };
    expect(Object.keys(userSnapshot(risky)).sort()).toEqual(["email", "isActive", "mustChangePassword", "name", "role"]);
  });
});
