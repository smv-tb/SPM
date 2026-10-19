import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Server code logs through src/lib/log.ts, which redacts. A raw `console.*`
 * would write whatever it is handed — typically a whole error, which for a
 * Prisma failure includes the row being written. Browser code (components,
 * client pages) may use the console; it never reaches the server's logs.
 */
const ROOT = join(process.cwd(), "src");
const SERVER_DIRS = ["app/api", "lib", "hermes", "schemas"];
/** Files that run in the browser or are the logger itself. */
const ALLOWED = new Set(["lib/log.ts", "lib/client-fetch.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("server logging", () => {
  const found = SERVER_DIRS.flatMap((d) => files(join(ROOT, d)));

  it("finds the server files", () => expect(found.length).toBeGreaterThan(100));

  it("uses the redacting logger instead of console.*", () => {
    const offenders = found
      .filter((f) => !ALLOWED.has(relative(ROOT, f)))
      .filter((f) => !/^\s*"use client"/.test(readFileSync(f, "utf8")))
      .filter((f) => /\bconsole\.(log|error|warn|info|debug)\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(offenders, "use logError / logWarn / logInfo from @/lib/log").toEqual([]);
  });
});
