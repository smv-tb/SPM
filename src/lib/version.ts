/** The version this build was made from (inlined from package.json by next.config.mjs). */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0-dev";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative if a < b, 0 if equal, positive if a > b. Anything that isn't x.y.z sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
