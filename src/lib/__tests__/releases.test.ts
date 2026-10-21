import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { compareVersions } from "@/lib/version";
import { RELEASES, releasesSince, type Release } from "@/lib/releases";

const r = (version: string): Release => ({ version, date: "2026-01-01", highlights: [version] });

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
  });
  it("sorts a non-release version lowest", () => {
    expect(compareVersions("0.0.0-dev", "0.1.0")).toBeLessThan(0);
  });
});

describe("releasesSince", () => {
  const all = [r("0.3.0"), r("0.2.0"), r("0.1.0")];
  it("returns only releases after the seen one, up to the current", () => {
    expect(releasesSince("0.1.0", "0.3.0", all).map((x) => x.version)).toEqual(["0.3.0", "0.2.0"]);
    expect(releasesSince("0.1.0", "0.2.0", all).map((x) => x.version)).toEqual(["0.2.0"]);
  });
  it("returns nothing when up to date", () => {
    expect(releasesSince("0.3.0", "0.3.0", all)).toEqual([]);
  });
});

describe("release notes", () => {
  it("are newest first and the top entry is the package version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(RELEASES[0].version).toBe(pkg.version);
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
    }
  });
});
