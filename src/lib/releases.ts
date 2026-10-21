import { compareVersions } from "@/lib/version";

export interface Release {
  version: string;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  /** Plain-language bullets for the people who use the tool, not for developers. */
  highlights: string[];
}

/**
 * Release notes, newest first. `yarn release <version>` refuses to run until the
 * top entry is the version being released, so notes are written before the tag.
 */
export const RELEASES: Release[] = [
  {
    version: "0.1.0",
    date: "2026-10-21",
    highlights: ["First numbered release. From now on you will be told here when something new arrives."],
  },
];

/** Releases newer than `seen` up to and including `current`, newest first. */
export function releasesSince(seen: string, current: string, releases: Release[] = RELEASES): Release[] {
  return releases.filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0);
}
