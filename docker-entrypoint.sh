#!/bin/sh
set -eu

cd /app

echo "→ Validating environment..."
if [ -z "${AUTH_SECRET:-}" ] || [ "${#AUTH_SECRET}" -lt 32 ]; then
  echo "✖ AUTH_SECRET is missing or too short (need ≥32 chars). Generate with: openssl rand -base64 32"
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "✖ DATABASE_URL is not set"
  exit 1
fi
# Two-factor sign-in settings. A typo here must stop the deploy: quietly meaning
# "nobody is required" would switch protection off, and requiring two-factor
# without a working encryption key would lock every admin out at next sign-in
# (they could not enrol). Rules mirror src/lib/mfa/policy.ts and src/lib/crypto.ts.
node -e '
const roles = process.env.MFA_REQUIRED_ROLES;      // unset = ADMIN,PM; empty or "none" = nobody
const from = process.env.MFA_ENFORCE_ALL_FROM;     // optional YYYY-MM-DD
const keys = process.env.DATA_ENCRYPTION_KEYS || "";
const fail = (m) => { console.error("✖ " + m); process.exit(1); };
let required = roles === undefined;
if (roles !== undefined && !/^\s*(none)?\s*$/i.test(roles)) {
  const ok = ["ADMIN", "PM", "CONTRIBUTOR", "VIEWER"];
  const bad = roles.split(",").map((r) => r.trim().toUpperCase()).filter((r) => !ok.includes(r));
  if (bad.length) fail("MFA_REQUIRED_ROLES has unknown role(s): " + bad.join(", "));
  required = true;
}
if (from && from.trim() !== "") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from.trim());
  const t = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || t.getUTCFullYear() !== +m[1] || t.getUTCMonth() !== +m[2] - 1 || t.getUTCDate() !== +m[3])
    fail("MFA_ENFORCE_ALL_FROM must be a real date like 2026-11-15, got \"" + from + "\"");
  required = true;
}
const entries = keys.split(",").map((e) => e.trim()).filter(Boolean);
const keysOk = entries.length > 0 && entries.every((e) => {
  const i = e.indexOf(":");
  return i > 0 && /^[A-Za-z0-9_-]{1,16}$/.test(e.slice(0, i)) && Buffer.from(e.slice(i + 1), "base64").length === 32;
});
if (required && !keysOk)
  fail("Two-factor sign-in is required for some roles, but DATA_ENCRYPTION_KEYS is " + (entries.length ? "invalid" : "not set") +
       " — nobody could enrol and admins would be locked out. Set it (echo \"k1:$(openssl rand -base64 32)\"), or set MFA_REQUIRED_ROLES=none to turn enforcement off.");
if (!keysOk) console.warn("⚠ DATA_ENCRYPTION_KEYS is not set — two-factor sign-in (and encrypted fields) will not work.");
'
if [ ! -f /app/prisma.config.mjs ]; then
  echo "✖ /app/prisma.config.mjs not found — build did not include Prisma config"
  exit 1
fi

echo "→ Running database migrations..."
# Migrations change the schema, which the application's own database role must
# not be able to do (docs/security/DB-ROLES.md). So they run as the schema owner,
# via MIGRATION_DATABASE_URL, and only for this one command; the app itself keeps
# DATABASE_URL. Unset (or the same URL) keeps the old single-role behaviour, with
# a warning.
MIGRATE_URL="${MIGRATION_DATABASE_URL:-}"
if [ -z "$MIGRATE_URL" ] || [ "$MIGRATE_URL" = "$DATABASE_URL" ]; then
  echo "⚠ MIGRATION_DATABASE_URL is not set (or equals DATABASE_URL): the app is connecting with the schema owner's"
  echo "  rights, so a compromised app could alter or drop tables and switch off the ledger/audit triggers."
  echo "  Set up the least-privilege role: docs/security/DB-ROLES.md"
  MIGRATE_URL="$DATABASE_URL"
fi
# Invoke the prisma CLI directly via node. This avoids relying on a
# `node_modules/.bin/prisma` symlink (which the Next.js standalone output
# doesn't ship) and removes the need for pnpm/corepack in the runner image.
DATABASE_URL="$MIGRATE_URL" node node_modules/prisma/build/index.js migrate deploy

echo "→ Starting application..."
echo "→ Starting Next.js standalone server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."

# Verify critical modules are loadable before starting (catches missing deps)
echo "→ Verifying runtime dependencies..."
# CJS modules — test directly
for mod in next @prisma/client pg bcryptjs; do
  if ! node -e "require('$mod')"; then
    echo "  ✖ Cannot require '$mod' — see error above"
    exit 1
  fi
done
# ESM modules that import from next/* — need the ESM loader to resolve
# next/server, next/headers, next/navigation (Next.js 16 has no exports map).
for mod in next-auth @auth/prisma-adapter; do
  if ! node --import ./register-loader.mjs -e "require('$mod')"; then
    echo "  ✖ Cannot require '$mod' — see error above"
    exit 1
  fi
done
echo "  ✔ All dependencies verified"

# Use the diagnostic proxy wrapper. It spawns server.js, captures its
# stdout/stderr, and dumps a full diagnostic report if the server exits
# cleanly with code 0 (which usually means it crashed silently). The proxy
# itself listens on PORT (3000) and forwards to server.js on 3001.
exec node ./server-wrapper.mjs
