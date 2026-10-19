import { logError, logWarn } from "@/lib/log";
import NextAuth, { CredentialsSignin } from "next-auth";
import type { Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { clientIp } from "@/lib/client-ip";
import { sessionStillValid } from "@/lib/session-validity";
import { BCRYPT_ROUNDS } from "@/lib/constants";
import {
  ACCOUNT_LOCK,
  MFA_LOCK,
  accountLocked,
  failureWindowExpired,
  loginAccountKey,
  mfaFailureKey,
  plausibleCredentials,
} from "@/lib/login-throttle";
import { isMfaEnabled, verifySecondFactor } from "@/lib/mfa/service";
import { mfaSetupRequired, policyFromEnv } from "@/lib/mfa/policy";
import { recordStepUp } from "@/lib/mfa/step-up";
import { auditAuthEvent, requestFacts } from "@/lib/auth-audit";
import { alertInBackground, isNewSignInAddress } from "@/lib/security-alerts";
import { randomUUID } from "node:crypto";

const RATELIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATELIMIT_MAX_FAILED_ATTEMPTS = 5;

const loginAttempts = new Map<string, { attempts: number; lockUntil: number }>();

// Stale entry cleanup: lazily purge expired entries on access instead of
// using a persistent interval (which leaks memory in serverless environments).
function cleanupStaleEntries(): void {
  const now = Date.now();
  for (const [key, entry] of loginAttempts.entries()) {
    if (now > entry.lockUntil) loginAttempts.delete(key);
  }
}

let _cleanupTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCleanup(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setTimeout(() => {
    _cleanupTimer = null;
    cleanupStaleEntries();
  }, 60 * 1000);
  // Allow Node.js to exit even if the timer is pending
  if (_cleanupTimer && typeof _cleanupTimer.unref === "function") {
    _cleanupTimer.unref();
  }
}

function getRateLimitKey(req: Request): string {
  return clientIp(req.headers) ?? "unknown";
}

export async function isRateLimited(req: Request): Promise<boolean> {
  const key = getRateLimitKey(req);

  const existing = await prisma.rateLimit.findUnique({ where: { key } });
  if (existing) {
    if (Date.now() > existing.expiresAt.getTime()) {
      await prisma.rateLimit.delete({ where: { key } });
      return false;
    }
    return existing.attempts >= RATELIMIT_MAX_FAILED_ATTEMPTS;
  }

  // Fast in-memory check (stale entries cleaned lazily above)
  const entry = loginAttempts.get(key);
  if (!entry) return false;

  if (Date.now() > entry.lockUntil) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.attempts >= RATELIMIT_MAX_FAILED_ATTEMPTS;
}

export async function recordFailedAttempt(req: Request): Promise<void> {
  const key = getRateLimitKey(req);
  const expiresAt = new Date(Date.now() + RATELIMIT_WINDOW_MS);

  await prisma.rateLimit.upsert({
    where: { key },
    update: { attempts: { increment: 1 }, expiresAt },
    create: { key, attempts: 1, expiresAt },
  });

  const existing = loginAttempts.get(key);
  const lockUntil = Date.now() + RATELIMIT_WINDOW_MS;
  if (existing && Date.now() <= existing.lockUntil) {
    loginAttempts.set(key, { attempts: existing.attempts + 1, lockUntil });
  } else {
    loginAttempts.set(key, { attempts: 1, lockUntil });
  }

  scheduleCleanup();
}

// ─── Per-account throttling ──────────────────────────────────────────────────
// Counted in the same table as the per-IP limiter, under an `account:` key
// (see src/lib/login-throttle.ts for why unknown emails are counted too).

async function isLocked(key: string, maxFailures: number): Promise<boolean> {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  return accountLocked(row, Date.now(), maxFailures);
}

/** Counts a failure and returns how many are now on record in the window. */
async function recordFailure(key: string, windowMs: number): Promise<number> {
  const now = Date.now();
  const expiresAt = new Date(now + windowMs);
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  const counted = await prisma.rateLimit.upsert({
    where: { key },
    // A finished window restarts at 1; otherwise count atomically.
    update: failureWindowExpired(row, now)
      ? { attempts: 1, expiresAt }
      : { attempts: { increment: 1 }, expiresAt },
    create: { key, attempts: 1, expiresAt },
  });
  // Unknown emails are counted too, so rows can pile up; drop finished ones.
  await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  return counted.attempts;
}

const clearFailures = (key: string) => prisma.rateLimit.delete({ where: { key } }).catch(() => {});

export const isAccountLocked = (email: string) => isLocked(loginAccountKey(email), ACCOUNT_LOCK.maxFailures);
export const recordAccountFailure = (email: string) => recordFailure(loginAccountKey(email), ACCOUNT_LOCK.windowMs);
export const clearAccountFailures = async (email: string) => void (await clearFailures(loginAccountKey(email)));

// Wrong second-factor codes are counted apart, and locked sooner (see login-throttle.ts).
export const isMfaLocked = (email: string) => isLocked(mfaFailureKey(email), MFA_LOCK.maxFailures);
export const recordMfaFailure = (email: string) => recordFailure(mfaFailureKey(email), MFA_LOCK.windowMs);
export const clearMfaFailures = async (email: string) => void (await clearFailures(mfaFailureKey(email)));

/**
 * What the sign-in page is told when a sign-in does not complete. Only these
 * three say anything beyond "invalid email or password", and none can be
 * reached without either the right password or a lock that applies the same
 * way to emails that have no account — so they reveal nothing about who exists.
 */
export class MfaRequiredError extends CredentialsSignin { code = "mfa_required"; }
export class InvalidMfaCodeError extends CredentialsSignin { code = "mfa_invalid"; }
export class TooManyAttemptsError extends CredentialsSignin { code = "too_many_attempts"; }

// bcrypt takes ~250ms. Comparing against this when the email matches no user
// keeps "no such account" as slow as "wrong password", so response time can't
// be used to find out who has an account. Hashed lazily, at the app's cost.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  return (dummyHash ??= bcrypt.hash(randomUUID(), BCRYPT_ROUNDS));
}

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 4 * 60 * 60, // 4 hours
  },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        code: { label: "Authentication code", type: "text" },
      },
      async authorize(credentials, req) {
        const request = req as Request;
        if (await isRateLimited(request)) {
          logWarn("auth", "rate limit exceeded for login attempt");
          throw new TooManyAttemptsError();
        }

        const email = credentials?.email;
        const password = credentials?.password;
        if (!plausibleCredentials(email, password)) return null;
        const code = typeof credentials?.code === "string" ? credentials.code.trim() : "";

        let user;
        try {
          // Locked accounts are refused before any password is checked, or the
          // lock would not stop anything. Attempts made while locked are not
          // counted, so a lock can't be extended by hammering it.
          if (await isAccountLocked(email)) {
            logWarn("auth", "login refused: account temporarily locked");
            throw new TooManyAttemptsError();
          }

          user = await prisma.user.findUnique({ where: { email } });

          // Exactly one bcrypt comparison whether or not the user exists.
          const hash = user?.password ?? (await getDummyHash());
          const valid = (await bcrypt.compare(password as string, hash)) && !!user?.password;

          if (!valid || !user) {
            await recordFailedAttempt(request);
            const failures = await recordAccountFailure(email);
            // Only real accounts are audited: anyone can invent emails, and the audit table can't be pruned.
            if (user) {
              const facts = requestFacts(request.headers);
              await auditAuthEvent(prisma, "auth.login_failed", user, facts, { reason: "wrong_password" });
              if (failures === ACCOUNT_LOCK.maxFailures) {
                await auditAuthEvent(prisma, "auth.lockout", user, facts, { kind: "password", minutes: ACCOUNT_LOCK.windowMs / 60000 });
                alertInBackground({ event: "auth.lockout", summary: `${user.email} was locked after repeated wrong passwords`, target: user.email, ipAddress: facts.ipAddress });
              }
            }
            return null;
          }

          let mfaVerified = false;
          let signInMethod = "password";

          // The password is right. If the account has a second factor it must be
          // proved in this same request: the page asks for the code and sends all
          // three together, so there is no half-signed-in state to steal or forge.
          // "Code required" is therefore only ever said to someone holding the password.
          if (isMfaEnabled(user)) {
            if (!code) throw new MfaRequiredError();
            if (await isMfaLocked(email)) {
              logWarn("auth", "login refused: second step temporarily locked");
              throw new TooManyAttemptsError();
            }
            const result = await prisma.$transaction((tx) =>
              verifySecondFactor(tx, user!.id, code, {
                actor: { type: "USER", id: user!.id, label: user!.email },
                ipAddress: clientIp(request.headers),
              })
            );
            if (!result.ok) {
              const failures = await recordMfaFailure(email);
              await recordFailedAttempt(request);
              const facts = requestFacts(request.headers);
              await auditAuthEvent(prisma, "auth.mfa_failed", user, facts, { reason: result.reason });
              if (failures === MFA_LOCK.maxFailures) {
                await auditAuthEvent(prisma, "auth.lockout", user, facts, { kind: "second_step", minutes: MFA_LOCK.windowMs / 60000 });
                alertInBackground({ event: "auth.lockout", summary: `${user.email} was locked after repeated wrong second-step codes`, target: user.email, ipAddress: facts.ipAddress });
              }
              throw new InvalidMfaCodeError();
            }
            await clearMfaFailures(email);
            mfaVerified = true;
            signInMethod = result.method === "recovery" ? "password+recovery_code" : "password+authenticator";
          }

          // Only the account's own counter is cleared. The per-IP one is left
          // to expire: clearing it on success would let anyone with a valid
          // login interleave it between guesses and never reach the limit.
          await clearAccountFailures(email);
          // A deactivated user is turned away by the signIn callback, so that isn't a sign-in.
          if (user.isActive) {
            const facts = requestFacts(request.headers);
            // Must be asked before this sign-in is recorded, or it would always be known.
            const newAddress =
              user.role === "ADMIN" && (await isNewSignInAddress(prisma, user.id, facts.ipAddress).catch(() => false));
            await auditAuthEvent(prisma, "auth.login", user, facts, { method: signInMethod });
            if (newAddress) {
              alertInBackground({ event: "auth.admin_new_ip", summary: `Administrator ${user.email} signed in from a new address`, target: user.email, ipAddress: facts.ipAddress });
            }
          }
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            securityStamp: user.securityStamp,
            mustChangePassword: user.mustChangePassword,
            mfaSetupRequired: mfaSetupRequired(user, Date.now(), policyFromEnv()),
            mfaVerified,
          };
        } catch (error) {
          // The three codes above are answers for the page, not failures.
          if (error instanceof CredentialsSignin) throw error;
          logError("auth", "authorize failed", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Reject disabled/inactive users
      if (!user.id) return false;
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { isActive: true },
        });
        if (!dbUser || !dbUser.isActive) return false;
      } catch {
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        // Sign-in: remember who this is and which security stamp it was issued under.
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.stamp = (user as { securityStamp?: string }).securityStamp;
        token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword === true;
        token.mfaSetupRequired = (user as { mfaSetupRequired?: boolean }).mfaSetupRequired === true;
        // An id for this session, so a step-up check made here can't unlock another browser.
        token.sid = randomUUID();
        if ((user as { mfaVerified?: boolean }).mfaVerified && user.id) {
          // Signing in with a code is itself a fresh second-factor check.
          try {
            await recordStepUp(prisma, user.id, token.sid as string);
          } catch (error) {
            logError("auth", "could not record sign-in step-up", error); // worst case: asked for a code once
          }
        }
        return token;
      }

      // Every later request: the user's row decides. A deactivated or deleted
      // user, a changed role or password (new stamp), or a token with no
      // stamp all end the session immediately — returning null clears it.
      // If the database can't answer we refuse too: a finance app should fail
      // closed, and every page needs the database anyway.
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            role: true, isActive: true, securityStamp: true, mustChangePassword: true,
            totpSecretEnc: true, totpEnabledAt: true,
          },
        });
        if (!sessionStillValid(token.stamp, dbUser)) return null;
        token.role = dbUser.role;
        token.mustChangePassword = dbUser.mustChangePassword;
        // Decided afresh every request, so enrolling (or an admin resetting
        // someone, or the grace date arriving) takes effect immediately.
        token.mfaSetupRequired = mfaSetupRequired(dbUser, Date.now(), policyFromEnv());
        return token;
      } catch (error) {
        logError("auth", "session check failed", error);
        return null;
      }
    },
    async session({ session, token }) {
      if (token) {
        const mutableSession = session as unknown as {
          user?: { id?: string; role?: string; mustChangePassword?: boolean; mfaSetupRequired?: boolean; sid?: string };
        };
        if (!mutableSession.user) mutableSession.user = {};
        mutableSession.user.id = token.id as string;
        mutableSession.user.role = token.role as string;
        mutableSession.user.mustChangePassword = token.mustChangePassword === true;
        mutableSession.user.mfaSetupRequired = token.mfaSetupRequired === true;
        mutableSession.user.sid = token.sid as string | undefined;
      }
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

/**
 * The current session, or null — and null **also** while the user owes
 * something before they may use the app: replacing a temporary password, or
 * setting up a second factor their role requires. Every page and route calls
 * this, so such a user is treated as signed out everywhere except the few
 * places that use `authIncludingPendingSetup`.
 */
export async function auth(): Promise<Session | null> {
  const session = await nextAuth.auth();
  const user = session?.user as { mustChangePassword?: boolean; mfaSetupRequired?: boolean } | undefined;
  return user?.mustChangePassword || user?.mfaSetupRequired ? null : session;
}

/**
 * Only for the setup pages and the endpoints they call (change password, set
 * up two-factor): lets a user in who still owes one of those. Never use it for
 * anything else.
 */
export async function authIncludingPendingSetup(): Promise<Session | null> {
  return nextAuth.auth();
}
