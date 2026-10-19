import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every API route handler must check who is calling, and every handler that
 * *changes* something must also check that they are allowed to. This is the
 * regression net for "a new route shipped without a guard" — the commonest way
 * for access control to fail, and one nothing else would notice.
 *
 * It reads the source rather than running the routes, so it is a tripwire, not a
 * proof: it catches a missing guard, not a wrong one. The behavioural proof is
 * prisma/checks/http-routes.ts (three roles over real sessions).
 */
const API = join(process.cwd(), "src/app/api");
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Establishes who is calling. */
const AUTHENTICATES =
  /\bauth\(\)|authIncludingPendingSetup\(|requireBooks\(|requireAdmin\(|requireAccount\(|requireAuth\(|withHermesAuth\(/;
/** Decides whether they are allowed: a role, a capability, or "it is your own account". */
const AUTHORIZES =
  /requireBooks\(|requireAdmin\(|hasPermission\(|requireAccount\(|withHermesAuth\(/;

/**
 * Handlers that are deliberately open or guard themselves some other way. Each
 * needs a reason; adding one here is a security decision, not a test fix.
 */
const OPEN: Record<string, string> = {
  "health/route.ts#GET": "liveness probe for Docker; returns only ok/error and touches no data",
  "auth/[...nextauth]/route.ts#GET": "NextAuth's own handlers: sign-in, session, CSRF token",
  "auth/[...nextauth]/route.ts#POST": "NextAuth's own handlers: sign-in, sign-out",
};

/**
 * Handlers that change data but need no role: they act only on the signed-in
 * user's own account, identified from their session and never from the request.
 */
const OWN_ACCOUNT_ONLY: Record<string, string> = {
  "account/password/route.ts#POST": "changes the caller's own password; needs the current password; id comes from the session",
  "account/default-project/route.ts#PUT": "sets the caller's own default project; the id comes from the session and the project is checked against those the caller may open",
  "account/profile/route.ts#PATCH": "changes only the caller's own display name; the id comes from the session; audited",
  "account/current-project/route.ts#POST": "only sets the caller's own project-choice cookie; every read re-checks it against the projects the caller may open",
};

/**
 * Routes that name a project, or one of its records, without going through the
 * current-project scope (S2.7). Each must call the project-access guard, or the
 * scoped reader, or a user who is not a member of that project could reach it
 * by guessing an id. Adding a route that touches project data? Add it here.
 */
const PROJECT_ACCESS = /requireProjectAccess\(|requireEntityAccess\(|projectFilterForRequest\(|resolveProjectScope\(|requireCurrentProject\(/;
const PROJECT_ROUTES = [
  "tasks/route.ts", "tasks/[id]/route.ts",
  "milestones/route.ts", "milestones/[id]/route.ts",
  "resources/route.ts", "resources/[id]/route.ts",
  "funding/route.ts", "funding/[id]/route.ts", "funding/[id]/stage/route.ts", "funding/[id]/tranches/route.ts",
  "funding/tranches/[trancheId]/route.ts", "funding/tranches/[trancheId]/receive/route.ts",
  "funding/analytics/route.ts", "funding/cash-flow/route.ts", "funding/variance/route.ts",
  "living-labs/route.ts", "living-labs/[id]/costs/route.ts", "living-labs/[id]/costs/[costId]/route.ts",
  "tags/route.ts", "tags/[id]/route.ts",
  "phases/route.ts", "phases/reorder/route.ts",
  "custom-fields/definitions/route.ts", "custom-fields/definitions/[id]/route.ts",
  "custom-fields/values/route.ts", "custom-fields/values/[id]/route.ts",
  "dashboard/route.ts",
  "project/route.ts", "project/[id]/route.ts", "project/[id]/archive/route.ts",
];

/** Handlers in those files that act on nothing project-owned, with the reason. */
const PROJECT_NOT_SCOPED: Record<string, string> = {
  "funding/cash-flow/route.ts#POST": "rebuilds the derived cash ledger for every project; PM+ (funding:sync) and changes only derived rows",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === "route.ts" ? [full] : [];
  });
}

interface Handler { id: string; method: string; body: string }

/**
 * Same-file functions by name, so a handler that delegates
 * (`export const PATCH = withErrorHandler(handleUpdateTask)`) is judged on the
 * function it actually runs.
 */
function localFunctions(src: string): Map<string, string> {
  const starts = [...src.matchAll(/^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+) = (?:async|withErrorHandler|\()/gm)];
  const topLevel = /^(?:export |async function |function |const |type |interface )/gm;
  const boundaries = [...src.matchAll(topLevel)].map((m) => m.index!);
  const map = new Map<string, string>();
  for (const m of starts) {
    const end = boundaries.find((b) => b > m.index!) ?? src.length;
    map.set(m[1] ?? m[2], src.slice(m.index!, end));
  }
  return map;
}

/** A handler's source plus the source of the same-file functions it calls (a few hops deep). */
function withDelegates(body: string, locals: Map<string, string>): string {
  let all = body;
  const seen = new Set<string>();
  for (let hop = 0; hop < 3; hop++) {
    const names = [...all.matchAll(/\b([A-Za-z_]\w*)\b/g)].map((m) => m[1]).filter((n) => locals.has(n) && !seen.has(n));
    if (names.length === 0) break;
    for (const n of names) { seen.add(n); all += "\n" + locals.get(n); }
  }
  return all;
}

/** Each exported handler and its source, up to the next one (or the end of the file). */
function handlersIn(file: string): Handler[] {
  const src = readFileSync(file, "utf8");
  const locals = localFunctions(src);
  const marker = new RegExp(`^export (?:const|async function|function) (${METHODS.join("|")})\\b`, "gm");
  const found = [...src.matchAll(marker)];
  // `export const { GET, POST } = handlers` style re-exports have no body to inspect.
  const destructured = [...src.matchAll(/^export const \{([^}]*)\} =/gm)].flatMap((m) =>
    m[1].split(",").map((n) => n.trim()).filter((n) => (METHODS as readonly string[]).includes(n))
  );
  const rel = relative(API, file);
  const handlers = found.map((m, i) => ({
    id: `${rel}#${m[1]}`,
    method: m[1],
    body: withDelegates(src.slice(m.index!, found[i + 1]?.index ?? src.length), locals),
  }));
  for (const method of destructured) handlers.push({ id: `${rel}#${method}`, method, body: "" });
  return handlers;
}

const handlers = routeFiles(API).flatMap(handlersIn);

describe("API route guards", () => {
  it("finds the routes (so an empty list can't make this pass)", () => {
    expect(handlers.length).toBeGreaterThan(100);
    expect(handlers.some((h) => h.id.startsWith("books/invoices/[id]/approve"))).toBe(true);
  });

  it("every exemption on the lists still exists (no stale ones)", () => {
    const ids = new Set(handlers.map((h) => h.id));
    for (const id of [...Object.keys(OPEN), ...Object.keys(OWN_ACCOUNT_ONLY)]) {
      expect(ids.has(id), `${id} is listed as exempt but not found`).toBe(true);
    }
  });

  it("an own-account exemption really does take the user from the session, not the request", () => {
    for (const id of Object.keys(OWN_ACCOUNT_ONLY)) {
      const body = handlers.find((h) => h.id === id)!.body;
      expect(body).toMatch(/sessionUser\?\.id|session\.user|account\.userId/);
      expect(body).not.toMatch(/params|searchParams|body\.(?:userId|id)\b/);
    }
  });

  it("every project-scoped route is on the project-access list below, and calls a project guard", () => {
    const ids = new Set(handlers.map((h) => h.id.split("#")[0]));
    for (const file of PROJECT_ROUTES) expect(ids.has(file), `${file} is listed but not found`).toBe(true);
    // A new route that reads or writes project-owned data without being listed here is the gap this catches.
    const touching = [...ids].filter((file) => {
      const src = readFileSync(join(API, file), "utf8");
      return /prisma\.(task|milestone|phase|tag|resource|fundingRecord|fundingTranche|livingLab|livingLabCost|customFieldDefinition|customFieldValue)\./.test(src);
    });
    const unlisted = touching.filter((f) => !PROJECT_ROUTES.includes(f));
    expect(unlisted, "these routes touch project data but are not on PROJECT_ROUTES").toEqual([]);
  });

  // Per handler, not per file: a new DELETE added to a guarded file must be guarded too.
  for (const h of handlers.filter((h) => PROJECT_ROUTES.includes(h.id.split("#")[0]) && !(h.id in PROJECT_NOT_SCOPED))) {
    it(`${h.id} checks project access`, () => {
      expect(h.body, `${h.id} has no project access check`).toMatch(PROJECT_ACCESS);
    });
  }

  for (const h of handlers.filter((h) => !(h.id in OPEN))) {
    it(`${h.id} checks who is calling`, () => {
      expect(h.body, `${h.id} has no authentication check`).toMatch(AUTHENTICATES);
    });
    if (MUTATING.has(h.method) && !(h.id in OWN_ACCOUNT_ONLY)) {
      it(`${h.id} checks the caller is allowed to change things`, () => {
        expect(h.body, `${h.id} changes data but only checks that someone is signed in`).toMatch(AUTHORIZES);
      });
    }
  }
});
