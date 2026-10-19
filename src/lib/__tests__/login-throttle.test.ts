import { describe, it, expect } from "vitest";
import {
  MFA_LOCK,
  mfaFailureKey,
  ACCOUNT_LOCK,
  accountLocked,
  failureWindowExpired,
  loginAccountKey,
  plausibleCredentials,
} from "@/lib/login-throttle";

const NOW = 1_000_000;
const row = (attempts: number, msFromNow: number) => ({ attempts, expiresAt: new Date(NOW + msFromNow) });

describe("loginAccountKey", () => {
  it("ignores case and surrounding space, so one account has one counter", () => {
    expect(loginAccountKey(" Finance@Example.COM ")).toBe(loginAccountKey("finance@example.com"));
  });

  it("is namespaced away from the per-IP keys", () => {
    expect(loginAccountKey("a@b.co").startsWith("account:")).toBe(true);
  });
});

describe("accountLocked", () => {
  it("is not locked with no failures recorded", () => {
    expect(accountLocked(null, NOW)).toBe(false);
  });

  it("tolerates up to maxFailures - 1 wrong passwords", () => {
    expect(accountLocked(row(ACCOUNT_LOCK.maxFailures - 1, 1000), NOW)).toBe(false);
  });

  it("locks at maxFailures while the window is open", () => {
    expect(accountLocked(row(ACCOUNT_LOCK.maxFailures, 1000), NOW)).toBe(true);
    expect(accountLocked(row(ACCOUNT_LOCK.maxFailures + 5, 1000), NOW)).toBe(true);
  });

  it("unlocks once the window has passed", () => {
    expect(accountLocked(row(ACCOUNT_LOCK.maxFailures, -1), NOW)).toBe(false);
    expect(accountLocked(row(ACCOUNT_LOCK.maxFailures, 0), NOW)).toBe(false);
  });
});

describe("failureWindowExpired", () => {
  it("restarts the count after an expired window, so an old lock can't re-lock instantly", () => {
    expect(failureWindowExpired(row(10, -1), NOW)).toBe(true);
    expect(failureWindowExpired(null, NOW)).toBe(true);
    expect(failureWindowExpired(row(3, 1000), NOW)).toBe(false);
  });
});

describe("plausibleCredentials", () => {
  it("accepts ordinary credentials", () => {
    expect(plausibleCredentials("a@example.com", "hunter2hunter2")).toBe(true);
  });

  it("refuses missing, empty and non-string values", () => {
    expect(plausibleCredentials(undefined, "x")).toBe(false);
    expect(plausibleCredentials("a@example.com", "")).toBe(false);
    expect(plausibleCredentials("", "x")).toBe(false);
    expect(plausibleCredentials({ toString: () => "a" }, "x")).toBe(false);
    expect(plausibleCredentials("a@example.com", ["x"])).toBe(false);
  });

  it("refuses absurdly long input before it reaches bcrypt", () => {
    expect(plausibleCredentials("a@example.com", "x".repeat(1025))).toBe(false);
    expect(plausibleCredentials("a".repeat(255), "x")).toBe(false);
  });
});

describe("second-factor throttle", () => {
  it("is tighter than the password one", () => {
    expect(MFA_LOCK.maxFailures).toBeLessThan(ACCOUNT_LOCK.maxFailures);
    expect(MFA_LOCK.windowMs).toBeGreaterThan(ACCOUNT_LOCK.windowMs);
  });

  it("locks at its own limit, not the password one", () => {
    expect(accountLocked(row(MFA_LOCK.maxFailures, 1000), NOW, MFA_LOCK.maxFailures)).toBe(true);
    expect(accountLocked(row(MFA_LOCK.maxFailures - 1, 1000), NOW, MFA_LOCK.maxFailures)).toBe(false);
    // five failures would not lock the password counter
    expect(accountLocked(row(MFA_LOCK.maxFailures, 1000), NOW)).toBe(false);
  });

  it("keeps its counter apart from the password one, one per account", () => {
    expect(mfaFailureKey(" A@B.co ")).toBe(mfaFailureKey("a@b.co"));
    expect(mfaFailureKey("a@b.co")).not.toBe(loginAccountKey("a@b.co"));
  });
});
