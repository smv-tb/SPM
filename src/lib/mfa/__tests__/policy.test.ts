import { describe, it, expect } from "vitest";
import {
  parseRequiredRoles, parseEnforceAllFrom, policyFromEnv, mfaRequiredFor, mfaSetupRequired, graceDeadline,
  MfaPolicyConfigError,
} from "@/lib/mfa/policy";

const NOW = Date.UTC(2026, 10, 1); // 1 Nov 2026
const DAY = 86_400_000;

describe("parseRequiredRoles", () => {
  it("defaults to admins and PMs when unset — secure unless someone opts out", () => {
    expect([...parseRequiredRoles(undefined)].sort()).toEqual(["ADMIN", "PM"]);
  });

  it("lets an empty value or 'none' mean nobody (dev and the browser suites)", () => {
    expect(parseRequiredRoles("").size).toBe(0);
    expect(parseRequiredRoles("  NONE ").size).toBe(0);
  });

  it("reads a list, ignoring case and spaces", () => {
    expect([...parseRequiredRoles("admin, pm ,Contributor")].sort()).toEqual(["ADMIN", "CONTRIBUTOR", "PM"]);
  });

  it("refuses a typo rather than quietly requiring nobody", () => {
    expect(() => parseRequiredRoles("ADMIN,PMM")).toThrow(MfaPolicyConfigError);
    expect(() => parseRequiredRoles("ADMIN,PMM")).toThrow(/PMM/);
  });
});

describe("parseEnforceAllFrom", () => {
  it("is off when unset or blank", () => {
    expect(parseEnforceAllFrom(undefined)).toBeNull();
    expect(parseEnforceAllFrom("  ")).toBeNull();
  });

  it("reads a date as UTC midnight", () => {
    expect(parseEnforceAllFrom("2026-11-15")).toBe(Date.UTC(2026, 10, 15));
  });

  it("refuses anything that is not a real date, so a typo can't switch enforcement off", () => {
    for (const bad of ["15/11/2026", "2026-13-01", "2026-02-30", "soon", "2026-11-1"]) {
      expect(() => parseEnforceAllFrom(bad)).toThrow(MfaPolicyConfigError);
    }
  });
});

describe("who is required", () => {
  const defaults = policyFromEnv({});
  const withDate = policyFromEnv({ MFA_ENFORCE_ALL_FROM: "2026-11-15" });

  it("requires admins and PMs straight away, and nobody else", () => {
    expect(mfaRequiredFor("ADMIN", NOW, defaults)).toBe(true);
    expect(mfaRequiredFor("PM", NOW, defaults)).toBe(true);
    expect(mfaRequiredFor("CONTRIBUTOR", NOW, defaults)).toBe(false);
    expect(mfaRequiredFor("VIEWER", NOW, defaults)).toBe(false);
  });

  it("requires everyone from the grace date on, and not a moment before", () => {
    const from = Date.UTC(2026, 10, 15);
    expect(mfaRequiredFor("VIEWER", from - 1, withDate)).toBe(false);
    expect(mfaRequiredFor("VIEWER", from, withDate)).toBe(true);
    expect(mfaRequiredFor("CONTRIBUTOR", from + 30 * DAY, withDate)).toBe(true);
  });

  it("treats an unrecognised role as required rather than exempt", () => {
    expect(mfaRequiredFor(undefined, NOW, defaults)).toBe(true);
    expect(mfaRequiredFor("SUPERUSER", NOW, policyFromEnv({ MFA_REQUIRED_ROLES: "none" }))).toBe(false);
  });
});

describe("mfaSetupRequired", () => {
  const policy = policyFromEnv({});
  const off = { totpSecretEnc: null, totpEnabledAt: null };
  const on = { totpSecretEnc: "v1.k1.x.y.z", totpEnabledAt: new Date() };

  it("forces a required user with no second factor into setup", () => {
    expect(mfaSetupRequired({ role: "ADMIN", ...off }, NOW, policy)).toBe(true);
  });

  it("leaves a required user who has one alone", () => {
    expect(mfaSetupRequired({ role: "ADMIN", ...on }, NOW, policy)).toBe(false);
  });

  it("treats a half-finished enrolment (secret stored, not confirmed) as not set up", () => {
    expect(mfaSetupRequired({ role: "PM", totpSecretEnc: "v1.k1.x.y.z", totpEnabledAt: null }, NOW, policy)).toBe(true);
  });

  it("leaves someone not yet required alone", () => {
    expect(mfaSetupRequired({ role: "CONTRIBUTOR", ...off }, NOW, policy)).toBe(false);
  });
});

describe("graceDeadline", () => {
  const policy = policyFromEnv({ MFA_ENFORCE_ALL_FROM: "2026-11-15" });

  it("gives the date to someone it will apply to", () => {
    expect(graceDeadline("CONTRIBUTOR", NOW, policy)).toBe(Date.UTC(2026, 10, 15));
  });

  it("gives nothing to someone already required, or once the date has passed", () => {
    expect(graceDeadline("ADMIN", NOW, policy)).toBeNull();
    expect(graceDeadline("VIEWER", Date.UTC(2026, 10, 16), policy)).toBeNull();
  });

  it("gives nothing when no date is set", () => {
    expect(graceDeadline("VIEWER", NOW, policyFromEnv({}))).toBeNull();
  });
});
