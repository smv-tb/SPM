#!/usr/bin/env bash
#
# Installs (or updates) the nightly encrypted backup on the production server.
# Run from your own machine; it needs the same SSH access deploy.sh uses.
#
#   deploy/backup/install.sh                       # public key read from ~/.smartvie-backup/identity.txt
#   deploy/backup/install.sh --recipient age1…     # or give the PUBLIC key explicitly
#   deploy/backup/install.sh --schedule nightly    # default is monthly (1st of the month, 02:30)
#
# Strictly additive and safe to re-run. It changes only:
#   * installs the `age` package (if it is not already there)
#   * /opt/smartvie-backups/          the backups (0700, root only), the script in bin/
#   * /opt/smartvie-backups/backup.conf   written only if it does not exist (never overwritten)
#   * /etc/cron.d/smartvie-backup     the backup run (monthly by default) and a daily freshness check
#   * /etc/logrotate.d/smartvie-backup
# Nothing else on the server — including other applications' cron jobs — is touched.
#
# It does NOT take a backup; run `smartvie_backup.py run` once afterwards to prove it works.
# The PRIVATE key must never be on the server: this script refuses to install one.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  for v in SSH_USER SSH_HOST SSH_PORT; do
    val="$(grep -s "^$v=" "$ROOT/.env" | cut -d= -f2- || true)"; [ -n "$val" ] && export "$v=$val"
  done
fi
SSH_USER="${SSH_USER:-root}"; SSH_HOST="${SSH_HOST:-}"; SSH_PORT="${SSH_PORT:-22}"
[ -n "$SSH_HOST" ] || { echo "✖ SSH_HOST is not set (put it in .env or export it)." >&2; exit 1; }
REMOTE_BACKUP_DIR="/opt/smartvie-backups"
IDENTITY="${SMARTVIE_BACKUP_IDENTITY:-$HOME/.smartvie-backup/identity.txt}"
RECIPIENT=""
SCHEDULE="monthly"

while [ $# -gt 0 ]; do
  case "$1" in
    --recipient) RECIPIENT="${2:?--recipient needs a value}"; shift 2 ;;
    --schedule) SCHEDULE="${2:?--schedule needs monthly or nightly}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$SCHEDULE" in
  monthly) RUN_CRON="30 2 1 * *"; MAX_AGE_HOURS=840 ;;   # check allows 35 days
  nightly) RUN_CRON="30 2 * * *"; MAX_AGE_HOURS=26 ;;
  *) echo "--schedule must be monthly or nightly" >&2; exit 2 ;;
esac

if [ -z "$RECIPIENT" ]; then
  [ -f "$IDENTITY" ] || { echo "No --recipient given and $IDENTITY not found (run age-keygen -o first)." >&2; exit 2; }
  RECIPIENT="$(age-keygen -y "$IDENTITY")"
fi
case "$RECIPIENT" in
  AGE-SECRET-KEY-*) echo "That is a PRIVATE key. Refusing: it must never be put on the server." >&2; exit 2 ;;
  age1*) ;;
  *) echo "Recipient must be an age public key (starts with age1…)." >&2; exit 2 ;;
esac
[[ "$RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || { echo "That does not look like a valid age public key." >&2; exit 2; }

# The unit tests are the gate: don't install a script whose retention logic fails.
echo "→ Running the backup tests…"
(cd "$HERE" && python3 -m unittest -q)

SSH=(ssh -p "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=10 "$SSH_USER@$SSH_HOST")
echo "→ Installing on $SSH_USER@$SSH_HOST"

"${SSH[@]}" "mkdir -p $REMOTE_BACKUP_DIR/bin && chmod 700 $REMOTE_BACKUP_DIR"
scp -P "$SSH_PORT" -q "$HERE/smartvie_backup.py" "$SSH_USER@$SSH_HOST:$REMOTE_BACKUP_DIR/bin/smartvie_backup.py"

# The values are handed over as shell-quoted assignments in the script text, NOT as arguments:
# ssh joins its arguments into one command line that the server's shell splits again, which
# turned the cron expression "30 2 1 * *" into separate words (and glob-expanded the stars).
{
  printf 'DIR=%q\nRECIPIENT=%q\nSCHEDULE=%q\nRUN_CRON=%q\nMAX_AGE_HOURS=%q\n' \
    "$REMOTE_BACKUP_DIR" "$RECIPIENT" "$SCHEDULE" "$RUN_CRON" "$MAX_AGE_HOURS"
  cat <<'REMOTE'
set -euo pipefail
if [ "$SCHEDULE" = monthly ]; then KEEP_DAILY=2; KEEP_WEEKLY=0; else KEEP_DAILY=7; KEEP_WEEKLY=4; fi

if ! command -v age >/dev/null 2>&1; then
  echo "  installing age…"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq age >/dev/null
fi
echo "  age: $(age --version)"

chmod 750 "$DIR/bin/smartvie_backup.py"; chown root:root "$DIR/bin/smartvie_backup.py"

if [ -e "$DIR/backup.conf" ]; then
  echo "  backup.conf exists — left alone"
else
  umask 077
  cat > "$DIR/backup.conf" <<CONF
# Smartvie backup settings. KEY=VALUE. Only the PUBLIC key goes here.
BACKUP_AGE_RECIPIENT=$RECIPIENT
BACKUP_DIR=$DIR
# Retention (grandfather-father-son): newest N of each, plus one copy per financial year.
# (Monthly backups: the two newest, then 12 months, then the year-end copies.)
BACKUP_KEEP_DAILY=$KEEP_DAILY
BACKUP_KEEP_WEEKLY=$KEEP_WEEKLY
BACKUP_KEEP_MONTHLY=12
BACKUP_KEEP_YEARLY=7
BACKUP_YEAR_END_MONTH=10
# Space limits, in MB. They are enforced on every run, whatever the schedule.
BACKUP_MAX_TOTAL_MB=200     # everything this job keeps, in total (oldest dropped first; newest two and year-end copies protected)
BACKUP_MAX_DUMP_MB=1024     # refuse a single dump larger than this (it would mean something grew unexpectedly)
BACKUP_MIN_FREE_MB=1024     # never run (or finish) if the disk would be left with less free than this
# Optional: a URL that receives a JSON POST when a backup fails or goes stale (e.g. an n8n webhook).
#BACKUP_WEBHOOK_URL=
CONF
  chmod 600 "$DIR/backup.conf"
  echo "  wrote backup.conf"
fi

# A new file in cron.d: root's own crontab (which runs other applications' jobs) is not touched.
cat > /etc/cron.d/smartvie-backup <<CRON
# Smartvie PM: encrypted database backup ($SCHEDULE). Installed by deploy/backup/install.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$RUN_CRON root /usr/bin/python3 /opt/smartvie-backups/bin/smartvie_backup.py run >> /var/log/smartvie-backup.log 2>&1
15 8 * * * root /usr/bin/python3 /opt/smartvie-backups/bin/smartvie_backup.py check --max-age-hours $MAX_AGE_HOURS >> /var/log/smartvie-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/smartvie-backup

# Verify what was written: exactly two jobs, each with five valid time fields. A malformed cron.d
# file is silently ignored by cron, which would mean no backups and no error — so fail here instead.
FIELD='[0-9*/,-]+'
if [ "$(grep -cE "^$FIELD $FIELD $FIELD $FIELD $FIELD root /usr/bin/python3 /opt/smartvie-backups/bin/smartvie_backup.py (run|check)" /etc/cron.d/smartvie-backup)" != 2 ]; then
  echo "✖ /etc/cron.d/smartvie-backup is malformed — refusing to continue:" >&2
  cat /etc/cron.d/smartvie-backup >&2
  exit 1
fi

cat > /etc/logrotate.d/smartvie-backup <<'LR'
/var/log/smartvie-backup.log {
    weekly
    rotate 12
    compress
    missingok
    notifempty
    create 0640 root root
}
LR
touch /var/log/smartvie-backup.log; chmod 640 /var/log/smartvie-backup.log
echo "  cron ($SCHEDULE):"; grep -E '^[0-9*]' /etc/cron.d/smartvie-backup | sed 's/ >> .*//; s#/usr/bin/python3 /opt/smartvie-backups/bin/smartvie_backup.py#smartvie_backup.py#; s/^/    /'
REMOTE
} | "${SSH[@]}" bash -s

echo "✔ Installed. Next: take the first backup and prove it restores:"
echo "    ssh $SSH_USER@$SSH_HOST /usr/bin/python3 $REMOTE_BACKUP_DIR/bin/smartvie_backup.py run"
