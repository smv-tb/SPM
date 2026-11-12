#!/usr/bin/env node
// Usage: yarn release <x.y.z>
// 1. Add the notes first: a new entry at the top of RELEASES in src/lib/releases.ts.
// 2. Run this on a clean, up-to-date main. It bumps package.json, commits and tags vX.Y.Z.
// Pushing (and deploying) stays with you: `git push && git push --tags`, then ./deploy.sh.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2];
const fail = (m) => {
  console.error(`✖ ${m}`);
  process.exit(1);
};
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) fail("Give the new version as x.y.z, e.g. yarn release 0.2.0");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
if (cmp(next, pkg.version) <= 0) fail(`${next} is not newer than the current ${pkg.version}`);
if (git("branch", "--show-current") !== "main") fail("Release from main");
if (git("status", "--porcelain")) fail("Working tree is not clean");
if (git("tag", "--list", `v${next}`)) fail(`Tag v${next} already exists`);

const notes = readFileSync("src/lib/releases.ts", "utf8");
const top = /RELEASES: Release\[\] = \[\s*\{\s*version: "([^"]+)"/.exec(notes)?.[1];
if (top !== next) fail(`Top entry in src/lib/releases.ts is ${top ?? "missing"}; add notes for ${next} first (and commit them)`);

pkg.version = next;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
git("commit", "-am", `Release v${next}`);
git("tag", "-a", `v${next}`, "-m", `Smartvie PM ${next}`);
console.log(`✔ Committed and tagged v${next}. Next: git push && git push --tags, then ./deploy.sh`);
