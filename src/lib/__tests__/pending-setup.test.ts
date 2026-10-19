import { describe, it, expect } from "vitest";
import { pendingSetupPath } from "@/lib/pending-setup";

describe("pendingSetupPath", () => {
  it("sends nobody anywhere when nothing is owed", () => {
    expect(pendingSetupPath({})).toBeNull();
    expect(pendingSetupPath(undefined)).toBeNull();
    expect(pendingSetupPath({ mustChangePassword: false, mfaSetupRequired: false })).toBeNull();
  });

  it("sends a temporary password to the password page", () => {
    expect(pendingSetupPath({ mustChangePassword: true })).toBe("/change-password");
  });

  it("sends a missing required second factor to its setup page", () => {
    expect(pendingSetupPath({ mfaSetupRequired: true })).toBe("/setup-two-factor");
  });

  it("does the password first when both are owed", () => {
    expect(pendingSetupPath({ mustChangePassword: true, mfaSetupRequired: true })).toBe("/change-password");
  });
});
