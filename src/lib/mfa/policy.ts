/**
 * Who must have a second factor. Pure (config and clock passed in) so the
 * rules can be unit-tested; `auth.ts` reads the environment and calls these.
 *
 * - `MFA_REQUIRED_ROLES`: comma-separated roles required **now**. Unset means
 *   `ADMIN,PM` (secure by default); empty or `none` means nobody (local dev and
 *   the browser test suites, which sign in as seeded admins).
 * - `MFA_ENFORCE_ALL_FROM`: a `YYYY-MM-DD` date from which **every** role is
 *   required. This is the grace period for everyone else: set it two weeks
 *   out, and a banner counts down until then.
 */
export const ALL_ROLES = ["ADMIN", "PM", "CONTRIBUTOR", "VIEWER"] as const;
const DEFAULT_REQUIRED = ["ADMIN", "PM"];

export interface MfaPolicy {
  requiredRoles: ReadonlySet<string>;
  /** Epoch ms (UTC midnight) from which every role is required, or null. */
  enforceAllFrom: number | null;
}

export class MfaPolicyConfigError extends Error {}

export function parseRequiredRoles(value: string | undefined): Set<string> {
  if (value === undefined) return new Set(DEFAULT_REQUIRED);
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return new Set();
  const roles = trimmed.split(",").map((r) => r.trim().toUpperCase());
  const unknown = roles.filter((r) => !(ALL_ROLES as readonly string[]).includes(r));
  // A typo must not silently mean "nobody is required".
  if (unknown.length > 0) throw new MfaPolicyConfigError(`MFA_REQUIRED_ROLES has unknown role(s): ${unknown.join(", ")}`);
  return new Set(roles);
}

export function parseEnforceAllFrom(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const ms = match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : NaN;
  // Date.UTC rolls 2026-13-01 and 2026-02-30 over into the next month, so the
  // parts must come back unchanged for the date to be real.
  const d = new Date(ms);
  if (!match || Number.isNaN(ms) || d.getUTCFullYear() !== +match[1] || d.getUTCMonth() !== +match[2] - 1 || d.getUTCDate() !== +match[3]) {
    throw new MfaPolicyConfigError(`MFA_ENFORCE_ALL_FROM must be a real date like 2026-11-15, got "${value}"`);
  }
  return ms;
}

export function policyFromEnv(env: Record<string, string | undefined> = process.env): MfaPolicy {
  return {
    requiredRoles: parseRequiredRoles(env.MFA_REQUIRED_ROLES),
    enforceAllFrom: parseEnforceAllFrom(env.MFA_ENFORCE_ALL_FROM),
  };
}

export function mfaRequiredFor(role: unknown, now: number, policy: MfaPolicy): boolean {
  if (typeof role !== "string") return true; // an unknown role gets the strictest treatment
  if (policy.requiredRoles.has(role)) return true;
  return policy.enforceAllFrom !== null && now >= policy.enforceAllFrom;
}

/** True when this user must set up a second factor before using anything else. */
export function mfaSetupRequired(
  user: { role: unknown; totpSecretEnc: string | null; totpEnabledAt: Date | null },
  now: number,
  policy: MfaPolicy
): boolean {
  const enabled = user.totpSecretEnc !== null && user.totpEnabledAt !== null;
  return !enabled && mfaRequiredFor(user.role, now, policy);
}

/** When a role not yet required will be, for the "set it up now" banner; null if there is no date ahead. */
export function graceDeadline(role: unknown, now: number, policy: MfaPolicy): number | null {
  if (mfaRequiredFor(role, now, policy)) return null;
  return policy.enforceAllFrom !== null && policy.enforceAllFrom > now ? policy.enforceAllFrom : null;
}
