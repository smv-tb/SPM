import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tripwire: every route that does something dangerous must ask for a fresh
 * second-factor check. A guard that quietly disappears in a refactor would
 * leave nothing failing and a stolen session able to move money, so the list is
 * pinned here. Adding a dangerous route? Add it, and its guard, together.
 */
const API = join(process.cwd(), "src/app/api");

// route file → what proves it is guarded
const GUARDED: Record<string, RegExp> = {
  "books/settings/lock-date/route.ts": /requireBooks\([^)]*stepUp:\s*isReopening/,
  "books/settings/route.ts": /bankDetailsChanged\([^)]*\)[\s\S]*stepUpGuard\(/,
  "books/bank-accounts/route.ts": /requireBooks\([^)]*stepUp:\s*true/,
  "books/bank-accounts/[id]/route.ts": /accountNumber !== undefined[\s\S]*stepUpGuard\(/,
  "users/route.ts": /export const POST[\s\S]*stepUpGuard\(/,
  "users/[id]/route.ts": /changeEndsSessions\([^)]*\)[\s\S]*stepUpGuard\([\s\S]*export const DELETE[\s\S]*stepUpGuard\(/,
  "users/[id]/mfa/reset/route.ts": /stepUpGuard\(/,
  "project/[id]/route.ts": /export const DELETE[\s\S]*stepUpGuard\(/,
  "books/contacts/[id]/anonymise/route.ts": /requireBooks\([^)]*stepUp:\s*true/,
};

/**
 * Routes where every mutating method is dangerous, checked method by method:
 * the source of each exported handler, up to the next one, must call the guard.
 * Granting and revoking project access both count — revoking is the containment
 * step in an incident, so it must not be the cheaper one with a stolen session.
 */
const GUARDED_METHODS: Record<string, readonly string[]> = {
  "project/[id]/members/route.ts": ["PUT", "DELETE"],
};

function handlerSource(src: string, method: string): string | null {
  const marker = /^export (?:const|async function|function) (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/gm;
  const found = [...src.matchAll(marker)];
  const i = found.findIndex((m) => m[1] === method);
  if (i === -1) return null;
  return src.slice(found[i].index!, found[i + 1]?.index ?? src.length);
}

describe("dangerous routes ask for a step-up", () => {
  for (const [file, proof] of Object.entries(GUARDED)) {
    it(file, () => {
      expect(readFileSync(join(API, file), "utf8")).toMatch(proof);
    });
  }

  for (const [file, methods] of Object.entries(GUARDED_METHODS)) {
    for (const method of methods) {
      it(`${file}#${method}`, () => {
        const body = handlerSource(readFileSync(join(API, file), "utf8"), method);
        expect(body, `${file} has no ${method} handler`).not.toBeNull();
        expect(body, `${file}#${method} does not ask for a step-up`).toMatch(/stepUpGuard\(/);
      });
    }
  }

  it("does not ask for it where it would be noise or a trap", () => {
    // Reading is not dangerous; and the step-up endpoint itself can't require a step-up.
    // Everyday accounting (approving, voiding, reversing) is deliberately not step-up: the
    // sign-in already needed a second factor, and a prompt on routine work costs more than it protects.
    for (const file of [
      "books/invoices/route.ts", "books/journals/route.ts", "account/step-up/route.ts",
      "books/invoices/[id]/approve/route.ts", "books/invoices/[id]/void/route.ts",
      "books/credit-notes/[id]/approve/route.ts", "books/credit-notes/[id]/void/route.ts",
      "books/journals/[id]/reverse/route.ts",
    ]) {
      expect(readFileSync(join(API, file), "utf8")).not.toMatch(/stepUp:\s*true|stepUpGuard\(/);
    }
  });
});
