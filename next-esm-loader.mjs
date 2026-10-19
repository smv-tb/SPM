import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NEXT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  'node_modules',
  'next',
);

let nextPkg = null;
function getNextPkg() {
  if (nextPkg) return nextPkg;
  try {
    nextPkg = JSON.parse(
      readFileSync(join(NEXT_ROOT, 'package.json'), 'utf8'),
    );
  } catch {
    nextPkg = {};
  }
  return nextPkg;
}

const EXTENSIONS = ['.js', '.mjs', '.cjs'];

function tryExtensions(base) {
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate)) {
      try {
        statSync(candidate);
        return candidate;
      } catch {}
    }
  }
  return null;
}

function tryDir(base) {
  if (!existsSync(base)) return null;
  try {
    if (statSync(base).isDirectory()) {
      for (const name of ['index.js', 'index.mjs', 'index.cjs']) {
        const candidate = join(base, name);
        if (existsSync(candidate)) {
          try {
            statSync(candidate);
            return candidate;
          } catch {}
        }
      }
    }
  } catch {}
  return null;
}

function resolveNextPath(subpath) {
  const base = join(NEXT_ROOT, subpath);

  const file = tryExtensions(base);
  if (file) return pathToFileURL(file).href;

  const dir = tryDir(base);
  if (dir) return pathToFileURL(dir).href;

  return null;
}

export function resolve(specifier, context, nextResolve) {
  const pkg = getNextPkg();

  if (
    !pkg.exports &&
    specifier.startsWith('next/') &&
    specifier !== 'next'
  ) {
    const subpath = specifier.slice(5);
    const resolved = resolveNextPath(subpath);
    if (resolved) {
      return {
        url: resolved,
        shortCircuit: true,
        format: 'commonjs',
      };
    }
  }

  return nextResolve(specifier, context);
}
