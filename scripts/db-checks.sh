#!/usr/bin/env bash
# Runs the database-only checks in prisma/checks/ against a throwaway PostgreSQL
# cluster that this script creates and removes. `yarn test:db`.
# Never touches DATABASE_URL from your environment or .env.
# The checks that need a dev server (HTTP, concurrency, MFA enforcement, e2e) are
# not run here; see prisma/checks/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

export LC_ALL=C
PORT="${DB_CHECKS_PORT:-55432}"
ROOT="$(mktemp -d /tmp/svpg.XXXXXX)"   # short path: unix sockets have a length limit on macOS
trap 'pg_ctl -D "$ROOT/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$ROOT"' EXIT

initdb -D "$ROOT/data" -U postgres --auth=trust >/dev/null
mkdir -p "$ROOT/sock"
pg_ctl -D "$ROOT/data" -l "$ROOT/log" -w \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$ROOT/sock" start >/dev/null

export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres
createdb books_test
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/books_test"
export DATA_ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)"
unset MIGRATION_DATABASE_URL

echo "▶ migrate"; npx prisma migrate deploy >/dev/null

fail=0
run() { echo "▶ $1"; shift; if ! "$@"; then echo "✘ FAILED: $*"; fail=1; fi; }
sql() { run "$1" psql -d books_test -q -v ON_ERROR_STOP=1 -f "prisma/checks/$1"; }
svc() { run "$1" npx tsx "prisma/checks/$1"; }

# Order matters: ledger-rules expects a fresh database and leaves state the later checks use.
sql ledger-rules.sql
sql sales-rules.sql
sql invoice-rules.sql
sql credit-note-rules.sql
sql payment-rules.sql
sql statement-rules.sql
svc posting-service.ts
svc invoice-service.ts
svc credit-note-service.ts
svc payment-service.ts
svc statement-service.ts
svc reconciliation-service.ts
svc bill-service.ts
svc balance-sheet.ts
svc profit-and-loss.ts
sql contact-anonymisation.sql
svc contact-privacy-service.ts

[ "$fail" = 0 ] && echo "✔ db checks passed" || { echo "✘ some db checks failed"; exit 1; }
