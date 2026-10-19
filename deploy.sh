#!/usr/bin/env bash
set -euo pipefail

# ─── CONFIG ───────────────────────────────────────────────────────────────────
if [ -f "$(dirname "$0")/.env" ]; then
  SSH_USER="$(grep -s '^SSH_USER=' "$(dirname "$0")/.env" | cut -d= -f2-)" || true
  SSH_HOST="$(grep -s '^SSH_HOST=' "$(dirname "$0")/.env" | cut -d= -f2-)" || true
  SSH_PORT="$(grep -s '^SSH_PORT=' "$(dirname "$0")/.env" | cut -d= -f2-)" || true
  REMOTE_DIR="$(grep -s '^REMOTE_DIR=' "$(dirname "$0")/.env" | cut -d= -f2-)" || true
fi

SSH_USER="${SSH_USER:-root}"
SSH_HOST="${SSH_HOST:-}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/smartvie-pm}"

if [ -z "$SSH_HOST" ]; then
  echo "✖ SSH_HOST is not set. Put SSH_HOST=your-server in .env (see .env.example) or export it." >&2
  exit 1
fi

SSH_OPTS="-p $SSH_PORT"
REMOTE="$SSH_USER@$SSH_HOST"

log() { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()  { echo -e "\033[1;32m✔ $*\033[0m"; }
err() { echo -e "\033[1;31m✖ $*\033[0m"; exit 1; }

# ─── 1. Sync source to server ────────────────────────────────────────────────
log "Syncing source to $REMOTE:$REMOTE_DIR ..."

ssh $SSH_OPTS "$REMOTE" "mkdir -p $REMOTE_DIR"

# Only ship files the Docker build needs. Anything not listed here is left on
# the server untouched — never pruned (we exclude rather than --delete to keep
# .env and other runtime state across deploys).
#
# .env/.env.local/.env.production are hard-excluded from the transfer itself —
# never remove these excludes. The server's env files hold real production
# secrets (DB credentials, AUTH_SECRET, etc.) and must never be clobbered by
# whatever's in the local working copy. (A previous version of this script
# only had `--filter='P .env'`, a delete-protection rule that does nothing
# since --delete is never passed here — it did NOT stop the transfer and let
# a local .env silently overwrite the server's real one.)
rsync -az \
  -e "ssh $SSH_OPTS" \
  --exclude='/.env' \
  --exclude='/.env.local' \
  --exclude='/.env.production' \
  --exclude='/node_modules' \
  --exclude='/.next' \
  --exclude='/.git' \
  --exclude='/.claude' \
  --exclude='/playwright-report' \
  --exclude='/test-results' \
  --exclude='/.DS_Store' \
  --exclude='/data' \
  --exclude='/scripts' \
  --exclude='/tests' \
  --exclude='/playwright.config.ts' \
  --exclude='/vitest.config.ts' \
  --exclude='/tsconfig.tsbuildinfo' \
  --exclude='/tsconfig.scripts.json' \
  --exclude='/AGENTS.md' \
  --exclude='/README.md' \
  --exclude='/ecosystem.config.cjs' \
  --exclude='/rollback.sh' \
  --exclude='/lr-auto-flow.json' \
  ./ "$REMOTE:$REMOTE_DIR/"

ok "Sync complete"

# ─── 2. Ensure .env exists on server ─────────────────────────────────────────
log "Checking .env on server..."

ssh $SSH_OPTS "$REMOTE" bash -s "$REMOTE_DIR" <<'ENDCHECK'
  REMOTE_DIR="$1"
  if [ ! -f "$REMOTE_DIR/.env" ]; then
    echo "⚠️  $REMOTE_DIR/.env not found. Creating template..."
    cat > "$REMOTE_DIR/.env" <<'EOF'
# ─── Database ────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@host:5432/smartvie_pm?schema=public
# If using the included PostgreSQL container (--profile with-db), also set:
# POSTGRES_USER=smartvie_pm
# POSTGRES_PASSWORD=...
# POSTGRES_DB=smartvie_pm
# and change DATABASE_URL to: postgresql://user:pass@db:5432/db?schema=public
# ─── NextAuth ─────────────────────────────────────────────────────────────────
# Generate: openssl rand -base64 32
AUTH_SECRET=change-me-in-production
NEXTAUTH_URL=https://your-domain.example.com
AUTH_TRUST_HOST=true
# ─── Encryption ───────────────────────────────────────────────────────────────
# Encrypts authenticator secrets (and later bank details) in the database.
# id:base64key, comma separated, FIRST is current. Generate the value with:
#   echo "k1:$(openssl rand -base64 32)"
# Keep a copy somewhere safe: without it those fields cannot be read back.
# To rotate, put a new key in front and keep the old one after it.
DATA_ENCRYPTION_KEYS=
# ─── Two-factor sign-in ───────────────────────────────────────────────────────
# Roles that must use it from their next sign-in (default ADMIN,PM; "none" =
# nobody). The deploy refuses to start if any role is required but
# DATA_ENCRYPTION_KEYS above is missing, since nobody could then enrol.
#MFA_REQUIRED_ROLES=ADMIN,PM
# Optional: from this date EVERY role is required (the grace period for the rest;
# a banner counts down to it).
#MFA_ENFORCE_ALL_FROM=2026-11-15
# ─── Server ───────────────────────────────────────────────────────────────────
PORT=3000
# IP(s) of the reverse proxy, comma-separated. Required behind a proxy, or
# every user shares the proxy's IP for rate limiting and the audit log.
TRUSTED_PROXY_IPS=
EOF
    echo "⚠️  Edit $REMOTE_DIR/.env with production values and re-run deploy."
    exit 1
  fi
  echo "✔ .env found"
ENDCHECK

# ─── 3. Build and start on server ────────────────────────────────────────────
log "Building and starting Docker containers on server..."

ssh $SSH_OPTS "$REMOTE" bash -s "$REMOTE_DIR" <<'ENDDEPLOY'
  set -euo pipefail
  cd "$1"

  if ! command -v docker &> /dev/null; then
    echo "✖ Docker not installed on server. Install Docker first."
    exit 1
  fi

  set -a
  source "$1/.env"
  set +a
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "✖ DATABASE_URL is not set in $1/.env"
    exit 1
  fi
  if [ -z "${AUTH_SECRET:-}" ]; then
    echo "✖ AUTH_SECRET is not set in $1/.env"
    exit 1
  fi
  if [ -z "${DATA_ENCRYPTION_KEYS:-}" ]; then
    echo "⚠️  DATA_ENCRYPTION_KEYS is not set in $1/.env — two-factor sign-in cannot be set up until it is."
  fi
  if [ -z "${TRUSTED_PROXY_IPS:-}" ]; then
    echo "⚠️  TRUSTED_PROXY_IPS is not set in $1/.env — client IPs will all read as the proxy's."
  fi

  echo "→ Building image and starting containers..."
  docker compose build --no-cache
  docker compose up -d

  echo ""
  echo "→ Waiting for health check (up to 120s)..."
  PORT="${PORT:-3000}"
  HEALTH_OK=false
  for i in $(seq 1 120); do
    if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
      HEALTH_OK=true
      echo "✔ Health check passed"
      break
    fi
    sleep 1
  done

  if [ "$HEALTH_OK" != "true" ]; then
    echo "✖ Health check failed. Checking logs..."
    docker compose logs --tail=30
    exit 1
  fi

  echo "→ Current containers:"
  docker compose ps
ENDDEPLOY

ok "Deployment complete — app is running on $SSH_HOST"