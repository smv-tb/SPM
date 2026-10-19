#!/usr/bin/env python3
"""
Nightly encrypted backup of the Smartvie PM database.

    smartvie_backup.py run            dump, verify, encrypt, write a manifest, then prune
    smartvie_backup.py prune          apply the retention policy (--dry-run to preview)
    smartvie_backup.py check          exit non-zero if the newest backup is too old
    smartvie_backup.py list           show what is kept

What a run does, in order, and why:

  1. pg_dump -Fc into a private temp directory (mode 0700, never world-readable).
  2. Verify the dump *before* it is encrypted: pg_restore must read its table
     of contents, and it must contain the tables and data we expect. Once it is
     encrypted this machine cannot read it again (the private key is not here),
     so this is the only moment it can be checked.
  3. Encrypt with `age` to the PUBLIC key only. The matching private key lives
     off this server, so someone who steals the backups (or the server) cannot
     read them.
  4. Delete the plaintext, write a manifest (sha256, size, row counts), and move
     the files into place atomically so a half-written backup is never mistaken
     for a good one.
  5. Only after a fully successful run, prune old backups. A failed run never
     deletes anything.

Standard library only (Debian's python3 is enough). Secrets are passed to
pg_dump/psql through the environment, never on a command line.

Configuration comes from the environment, then /opt/smartvie-backups/backup.conf
(KEY=VALUE lines), and DATABASE_URL from /opt/smartvie-pm/.env.
"""
from __future__ import annotations

import argparse
import contextlib
import dataclasses
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, Optional

# ── naming ────────────────────────────────────────────────────────────────────
# Anything this script writes or deletes must match this pattern. Pruning
# refuses to touch a file that does not, so a typo in config can never point it
# at someone else's files.
# `\Z`, not `$`: `$` also matches just before a trailing newline, and this pattern is
# the gate on what pruning may delete.
BACKUP_NAME = re.compile(r"^smartvie_pm-(\d{8})-(\d{6})\.dump\.age\Z")
MANIFEST_SUFFIX = ".manifest.json"
AGE_RECIPIENT = re.compile(r"^age1[02-9ac-hj-np-z]{58}\Z")  # bech32 charset


def backup_name(when: dt.datetime) -> str:
    return f"smartvie_pm-{when:%Y%m%d-%H%M%S}.dump.age"


def parse_backup_time(name: str) -> Optional[dt.datetime]:
    """UTC time encoded in a backup file name, or None if it is not one of ours."""
    m = BACKUP_NAME.match(name)
    if not m:
        return None
    try:
        return dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


# ── retention ─────────────────────────────────────────────────────────────────
@dataclasses.dataclass(frozen=True)
class Policy:
    """Grandfather-father-son: recent detail, then thinning out, then long-term."""

    daily: int = 7
    weekly: int = 4
    monthly: int = 12
    yearly: int = 7
    # The statutory year ends on the last day of this month; one copy per
    # financial year is kept for `yearly` years (6 years of records + the current one).
    year_end_month: int = 10


def _financial_year(when: dt.datetime, year_end_month: int) -> int:
    return when.year if when.month <= year_end_month else when.year + 1


def select_keep(times: Iterable[dt.datetime], policy: Policy) -> set[dt.datetime]:
    """
    Which backups to keep. For each period the *latest* backup in it is the one
    kept (the newest state of that day / week / month / financial year):

      * the latest backup of each of the newest `daily` distinct days
      * ... of each of the newest `weekly` ISO weeks
      * ... of each of the newest `monthly` months
      * ... of each of the newest `yearly` financial years
      * and always the single newest backup, whatever the policy says

    Pure: depends only on its arguments, so it is exhaustively unit-tested.
    """
    ordered = sorted(set(times), reverse=True)  # newest first
    if not ordered:
        return set()

    def newest_per(bucket, count: int) -> set[dt.datetime]:
        seen: dict = {}
        for t in ordered:  # newest first, so the first seen in a bucket is its latest
            seen.setdefault(bucket(t), t)
        newest_buckets = sorted(seen, reverse=True)[: max(count, 0)]
        return {seen[b] for b in newest_buckets}

    keep = {ordered[0]}
    keep |= newest_per(lambda t: t.date(), policy.daily)
    keep |= newest_per(lambda t: t.isocalendar()[:2], policy.weekly)
    keep |= newest_per(lambda t: (t.year, t.month), policy.monthly)
    keep |= newest_per(lambda t: _financial_year(t, policy.year_end_month), policy.yearly)
    return keep


def plan_prune(names: Iterable[str], policy: Policy) -> tuple[list[str], list[str]]:
    """(keep, delete) over backup file names. Names that are not ours are in neither list."""
    by_time = {}
    for name in names:
        t = parse_backup_time(name)
        if t is not None:
            by_time[t] = name
    keep_times = select_keep(by_time, policy)
    keep = sorted(by_time[t] for t in by_time if t in keep_times)
    delete = sorted(by_time[t] for t in by_time if t not in keep_times)
    return keep, delete


# ── space limits ──────────────────────────────────────────────────────────────
def space_ok(free_bytes: int, dump_bytes: int, min_free_bytes: int) -> bool:
    """
    Room to finish and still leave the disk comfortable: the plaintext dump and its
    encrypted copy exist side by side briefly (about 2x), so need that plus the
    configured minimum to remain free afterwards.
    """
    return free_bytes - 2 * dump_bytes >= min_free_bytes


def enforce_budget(
    entries: dict[str, int],
    policy: Policy,
    budget_bytes: int,
    protect_newest: int = 2,
) -> tuple[list[str], bool]:
    """
    Keep the backup folder inside a size budget, whatever else happens.

    `entries` maps each kept backup's name to its size on disk (file + manifest).
    Returns (names to delete, still_over_budget). Oldest go first. Never deleted:
      * the newest `protect_newest` backups (so there is always something recent), and
      * the financial-year-end copies, which are the long-term record.
    If only protected backups remain and the folder is still over budget, nothing
    more is deleted and `still_over_budget` is True — a human decision, and the run
    reports it loudly rather than discard the long-term record.
    """
    times = {t: n for n in entries if (t := parse_backup_time(n)) is not None}
    protected = {times[t] for t in sorted(times, reverse=True)[:protect_newest]}
    protected |= {times[t] for t in select_keep(times, Policy(daily=0, weekly=0, monthly=0, yearly=policy.yearly,
                                                              year_end_month=policy.year_end_month))}
    total = sum(entries.values())
    delete: list[str] = []
    for t in sorted(times):  # oldest first
        if total <= budget_bytes:
            break
        name = times[t]
        if name in protected:
            continue
        delete.append(name)
        total -= entries[name]
    return delete, total > budget_bytes


# ── configuration ─────────────────────────────────────────────────────────────
def read_kv_file(path: Path) -> dict[str, str]:
    """KEY=VALUE lines, # comments, optional quotes. Missing file = empty."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            # `KEY=200   # a note`: an unquoted value ends at whitespace followed by '#'.
            # (A '#' with no space before it, as in a URL fragment, is part of the value.)
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        values[key] = value
    return values


@dataclasses.dataclass
class Config:
    database_url: str
    backup_dir: Path
    recipient: str
    webhook_url: Optional[str]
    policy: Policy
    # A sanity floor, not an exact count: it catches an empty or truncated dump, and must
    # sit well below the real schema (46 tables at the time of writing) so a normal run passes.
    min_tables: int = 30
    # Space limits (all in the config file, in MB). A backup system that fills the
    # disk it protects is worse than none, so every one of these is enforced.
    max_total_bytes: int = 200 * 1024 * 1024   # everything this job keeps, in total
    max_dump_bytes: int = 1024 * 1024 * 1024   # one plaintext dump; far above today's 0.3 MB
    min_free_bytes: int = 1024 * 1024 * 1024   # the disk must stay at least this free

    @staticmethod
    def load(env_file: Path, conf_file: Path, environ=os.environ) -> "Config":
        merged: dict[str, str] = {}
        merged.update(read_kv_file(env_file))   # DATABASE_URL lives with the app's settings
        merged.update(read_kv_file(conf_file))
        merged.update({k: v for k, v in environ.items() if k.startswith(("BACKUP_", "DATABASE_URL"))})

        def need(key: str) -> str:
            if not merged.get(key):
                raise ConfigError(f"{key} is not set")
            return merged[key]

        recipient = need("BACKUP_AGE_RECIPIENT").strip()
        if not AGE_RECIPIENT.match(recipient):
            raise ConfigError("BACKUP_AGE_RECIPIENT must be an age PUBLIC key (starts with age1…)")
        policy = Policy(
            daily=int(merged.get("BACKUP_KEEP_DAILY", 7)),
            weekly=int(merged.get("BACKUP_KEEP_WEEKLY", 4)),
            monthly=int(merged.get("BACKUP_KEEP_MONTHLY", 12)),
            yearly=int(merged.get("BACKUP_KEEP_YEARLY", 7)),
            year_end_month=int(merged.get("BACKUP_YEAR_END_MONTH", 10)),
        )
        if not 1 <= policy.year_end_month <= 12:
            raise ConfigError("BACKUP_YEAR_END_MONTH must be 1-12")
        for key in ("BACKUP_MAX_TOTAL_MB", "BACKUP_MAX_DUMP_MB", "BACKUP_MIN_FREE_MB"):
            if key in merged and not (merged[key].isdigit() and int(merged[key]) > 0):
                raise ConfigError(f"{key} must be a positive whole number of megabytes")
        # The app's own database role is least-privilege and cannot read everything a dump
        # needs (docs/security/DB-ROLES.md), so a dedicated read-only role may be given here.
        return Config(
            database_url=merged.get("BACKUP_DATABASE_URL") or need("DATABASE_URL"),
            backup_dir=Path(merged.get("BACKUP_DIR", "/opt/smartvie-backups")),
            recipient=recipient,
            webhook_url=merged.get("BACKUP_WEBHOOK_URL") or None,
            policy=policy,
            max_total_bytes=int(merged.get("BACKUP_MAX_TOTAL_MB", 200)) * 1024 * 1024,
            max_dump_bytes=int(merged.get("BACKUP_MAX_DUMP_MB", 1024)) * 1024 * 1024,
            min_free_bytes=int(merged.get("BACKUP_MIN_FREE_MB", 1024)) * 1024 * 1024,
        )


class ConfigError(Exception):
    pass


class BackupError(Exception):
    pass


class AuditChainError(BackupError):
    pass


def database_env(database_url: str, base: Optional[dict[str, str]] = None) -> dict[str, str]:
    """
    libpq settings for pg_dump/psql from a postgresql:// URL, as environment
    variables. Passing the URL itself as an argument would put the password in
    the process list for anyone on the machine to read. Prisma's `?schema=`
    query parameter means nothing to libpq and is dropped.
    """
    u = urllib.parse.urlparse(database_url)
    if u.scheme not in ("postgres", "postgresql"):
        raise ConfigError("DATABASE_URL must be a postgresql:// URL")
    env = dict(base if base is not None else os.environ)
    env["PGHOST"] = u.hostname or "localhost"
    env["PGPORT"] = str(u.port or 5432)
    env["PGDATABASE"] = urllib.parse.unquote(u.path.lstrip("/")) or "postgres"
    if u.username:
        env["PGUSER"] = urllib.parse.unquote(u.username)
    if u.password:
        env["PGPASSWORD"] = urllib.parse.unquote(u.password)
    query = urllib.parse.parse_qs(u.query)
    if "sslmode" in query:
        env["PGSSLMODE"] = query["sslmode"][0]
    return env


# ── running things ────────────────────────────────────────────────────────────
def run(cmd: list[str], env: Optional[dict[str, str]] = None, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, env=env, capture_output=True, text=True, **kw)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ── choosing the PostgreSQL client tools ──────────────────────────────────────
# pg_dump must be at least as new as the server, and pg_restore (used to verify) must be
# at least as new as the pg_dump that wrote the archive. On Debian the bare `pg_dump` is a
# wrapper that quietly picks a *different version depending on the environment*, so the
# dump and the verify step used different versions and the verify failed. Instead: find the
# server's major version, pick one directory of tools for it, and use that directory for
# everything (dump, verify, counts).
def tool_dir_candidates(major: int) -> list[str]:
    return [
        f"/usr/lib/postgresql/{major}/bin",                # Debian / Ubuntu
        f"/opt/homebrew/opt/postgresql@{major}/bin",       # Homebrew (Apple silicon)
        f"/usr/local/opt/postgresql@{major}/bin",          # Homebrew (Intel)
        f"/usr/pgsql-{major}/bin",                         # RHEL / PGDG
    ]


def pick_tool_dir(major: int, probe) -> Optional[str]:
    """
    The tools to use for a server of this major version. `probe(dir)` returns the
    major version of the pg_dump in `dir` (None if the directory has no usable
    pg_dump + pg_restore). An exact match wins; otherwise the oldest newer version.
    Never an older one: it cannot dump a newer server.
    """
    # Candidate order is the preference order: an explicit versioned directory beats the bare
    # PATH name (on Debian that is a wrapper whose version depends on the environment).
    ordered = tool_dir_candidates(major) + [""]  # "" = whatever is on PATH, last resort
    usable: list[tuple[int, int, str]] = []
    for position, d in enumerate(ordered):
        v = probe(d)
        if v is not None and v >= major:
            usable.append((v, position, d))
    return min(usable)[2] if usable else None


def probe_tool_dir(d: str) -> Optional[int]:
    dump = str(Path(d) / "pg_dump") if d else shutil.which("pg_dump")
    restore = str(Path(d) / "pg_restore") if d else shutil.which("pg_restore")
    if not dump or not restore or not (os.access(dump, os.X_OK) and os.access(restore, os.X_OK)):
        return None
    p = run([dump, "--version"])
    m = re.search(r"(\d+)(?:\.\d+)?", p.stdout) if p.returncode == 0 else None
    return int(m.group(1)) if m else None


def tool(directory: str, name: str) -> str:
    return str(Path(directory) / name) if directory else name


def server_major(env: dict[str, str]) -> int:
    p = run(["psql", "-X", "-At", "-c", "SHOW server_version_num"], env=env)
    if p.returncode != 0 or not p.stdout.strip().isdigit():
        raise BackupError(f"cannot read the database server version: {p.stderr.strip()[:200]}")
    return int(p.stdout.strip()) // 10000


COUNT_QUERIES = {
    "users": 'SELECT count(*) FROM users',
    "audit_logs": 'SELECT count(*) FROM audit_logs',
    "journal_entries": 'SELECT count(*) FROM journal_entries',
    "invoices": 'SELECT count(*) FROM invoices',
    "migrations": 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL',
}


def row_counts(env: dict[str, str], psql: str = "psql") -> dict[str, int]:
    counts = {}
    for key, sql in COUNT_QUERIES.items():
        p = run([psql, "-X", "-At", "-c", sql], env=env)
        if p.returncode != 0:
            raise BackupError(f"could not count {key}: {p.stderr.strip()[:200]}")
        counts[key] = int(p.stdout.strip())
    return counts


def count_tables(toc_lines: list[str]) -> int:
    """Tables in a `pg_restore --list`. Only the table definitions: `TABLE DATA` rows and the
    permission entries (`ACL … TABLE users …`, which appear once roles have explicit grants)
    mention the word TABLE too and are not tables."""
    return sum(1 for line in toc_lines if re.match(r"\d+; \d+ \d+ TABLE (?!DATA)", line))


def verify_dump(dump: Path, min_tables: int, pg_restore: str = "pg_restore") -> dict:
    """What can only be checked while the dump is still readable."""
    toc = run([pg_restore, "--list", str(dump)])
    if toc.returncode != 0:
        raise BackupError(f"pg_restore cannot read the dump: {toc.stderr.strip()[:300]}")
    lines = toc.stdout.splitlines()
    tables = count_tables(lines)
    if tables < min_tables:
        raise BackupError(f"dump has only {tables} tables (expected at least {min_tables})")
    for must in ("TABLE DATA public users", "TABLE DATA public audit_logs", "TABLE DATA public _prisma_migrations"):
        if not any(must in line for line in lines):
            raise BackupError(f"dump is missing {must!r}")
    version = next((l.split("database version", 1)[1].strip(" :\t") for l in lines if "Dumped from database version" in l), "unknown")
    return {"tables": tables, "pgServerVersion": version, "tocEntries": sum(1 for l in lines if l and not l.startswith(";"))}


# ── audit-log hash chain (S3.3) ───────────────────────────────────────────────
AUDIT_HEAD_FILE = "audit_head.json"


def audit_chain_state(env: dict[str, str], psql: str = "psql") -> dict:
    """Walks the audit log's hash chain in the database (audit_chain_check())."""
    p = run([psql, "-X", "-At", "-F", "|", "-c", 'SELECT "rows", "headSeq", "headHash", "brokenAt" FROM audit_chain_check()'], env=env)
    if p.returncode != 0:
        raise BackupError(f"could not check the audit chain: {p.stderr.strip()[:200]}")
    rows, head_seq, head_hash, broken = p.stdout.strip().split("|")
    return {"rows": int(rows), "headSeq": int(head_seq), "headHash": head_hash, "brokenAt": int(broken) if broken else None}


def judge_audit_chain(state: dict, previous: Optional[dict], hash_at_previous: Optional[str]) -> Optional[str]:
    """None if the chain is sound, else what is wrong.

    `previous` is the head recorded by the last check; `hash_at_previous` is what the database
    now holds at that position. Walking the chain finds edits and deletions *inside* it; the
    recorded head is what catches a chain that was cut short or rebuilt from the start.
    """
    if state["brokenAt"] is not None:
        return f"audit log chain is broken at entry {state['brokenAt']} (an entry was changed, removed or inserted)"
    if previous:
        if state["headSeq"] < previous["headSeq"]:
            return f"audit log is shorter than before: head was entry {previous['headSeq']}, now {state['headSeq']}"
        if hash_at_previous != previous["headHash"]:
            return f"audit log entry {previous['headSeq']} no longer matches the hash recorded earlier (history was rewritten)"
    return None


def do_audit_check(cfg: Config) -> dict:
    """Verifies the chain and records its head next to the backups (and in each backup's manifest)."""
    env = database_env(cfg.database_url)
    tools = pick_tool_dir(server_major(env), probe_tool_dir)
    psql = tool(tools, "psql") if tools is not None else "psql"
    if tools and not os.access(psql, os.X_OK):
        psql = "psql"
    state = audit_chain_state(env, psql)
    head_path = cfg.backup_dir / AUDIT_HEAD_FILE
    previous = json.loads(head_path.read_text()) if head_path.is_file() else None
    at_previous = None
    if previous and state["brokenAt"] is None:
        p = run([psql, "-X", "-At", "-c", f'SELECT "hash" FROM audit_logs WHERE "chainSeq" = {int(previous["headSeq"])}'], env=env)
        if p.returncode != 0:
            raise BackupError(f"could not read the audit chain: {p.stderr.strip()[:200]}")
        at_previous = p.stdout.strip() or None
    problem = judge_audit_chain(state, previous, at_previous)
    if problem:
        raise AuditChainError(problem)
    prepare_dir(cfg.backup_dir)
    tmp = cfg.backup_dir / (AUDIT_HEAD_FILE + ".partial")
    tmp.write_text(json.dumps({**state, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat()}, indent=2) + "\n")
    os.replace(tmp, head_path)
    log(f"ok: audit chain intact, {state['rows']} entries, head {state['headHash'][:12]}…")
    return state


def encrypt(plain: Path, out: Path, recipient: str) -> None:
    p = run(["age", "-r", recipient, "-o", str(out), str(plain)])
    if p.returncode != 0:
        raise BackupError(f"age failed: {p.stderr.strip()[:300]}")


def notify(cfg: Config, status: str, message: str, **details) -> None:
    """Best-effort alert/heartbeat. Never lets a notification problem fail a backup."""
    if not cfg.webhook_url:
        return
    body = json.dumps({"service": "smartvie-backup", "status": status, "message": message, **details}).encode()
    req = urllib.request.Request(cfg.webhook_url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:  # noqa: BLE001 — deliberately broad: alerting must not break the job
        log(f"warning: could not send {status} notification: {e}")


def log(message: str) -> None:
    print(f"{dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M:%S}Z {message}", flush=True)


@contextlib.contextmanager
def exclusive_lock(directory: Path):
    """One run at a time: a slow dump must not overlap the next night's."""
    lock = directory / ".lock"
    with open(lock, "w") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError("another backup is already running")
        yield


# ── commands ──────────────────────────────────────────────────────────────────
def prepare_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)


def do_run(cfg: Config, now: Optional[dt.datetime] = None) -> Path:
    now = now or dt.datetime.now(dt.timezone.utc)
    prepare_dir(cfg.backup_dir)
    with exclusive_lock(cfg.backup_dir):
        free = shutil.disk_usage(cfg.backup_dir).free
        if free < cfg.min_free_bytes:
            raise BackupError(f"only {free // (1024 * 1024)} MiB free in {cfg.backup_dir}")

        env = database_env(cfg.database_url)
        major = server_major(env)
        tools = pick_tool_dir(major, probe_tool_dir)
        if tools is None:
            raise BackupError(f"no PostgreSQL client tools of version {major} or newer found (install postgresql-client-{major})")
        pg_dump, pg_restore, psql = tool(tools, "pg_dump"), tool(tools, "pg_restore"), tool(tools, "psql")
        if tools and not os.access(psql, os.X_OK):
            psql = "psql"
        log(f"database server is PostgreSQL {major}; using tools from {tools or 'PATH'}")
        name = backup_name(now)
        final = cfg.backup_dir / name
        if final.exists():
            raise BackupError(f"{name} already exists")

        os.umask(0o077)
        tmp = Path(tempfile.mkdtemp(prefix=".work-", dir=cfg.backup_dir))
        try:
            os.chmod(tmp, 0o700)
            plain = tmp / "dump"

            before = row_counts(env, psql)
            audit_chain = audit_chain_state(env, psql)
            if audit_chain["brokenAt"] is not None:
                raise AuditChainError(f"audit log chain is broken at entry {audit_chain['brokenAt']}; backing up anyway would hide it — investigate first")
            p = run([pg_dump, "-Fc", "--no-password", "-f", str(plain)], env=env)
            if p.returncode != 0:
                raise BackupError(f"pg_dump failed: {p.stderr.strip()[:400]}")
            after = row_counts(env, psql)

            plain_size = plain.stat().st_size
            if plain_size > cfg.max_dump_bytes:
                raise BackupError(
                    f"the dump is {plain_size // (1024 * 1024)} MB, over the {cfg.max_dump_bytes // (1024 * 1024)} MB limit "
                    f"(BACKUP_MAX_DUMP_MB) — something has grown unexpectedly; look before raising the limit")
            free_now = shutil.disk_usage(cfg.backup_dir).free
            if not space_ok(free_now, plain_size, cfg.min_free_bytes):
                raise BackupError(
                    f"not enough free space to encrypt safely: {free_now // (1024 * 1024)} MB free, "
                    f"need {(2 * plain_size + cfg.min_free_bytes) // (1024 * 1024)} MB (BACKUP_MIN_FREE_MB)")
            checked = verify_dump(plain, cfg.min_tables, pg_restore)

            partial = tmp / (name + ".partial")
            encrypt(plain, partial, cfg.recipient)
            plain.unlink()  # the only plaintext copy goes the moment it has been encrypted

            manifest = {
                "file": name,
                "createdAt": now.isoformat(),
                "sha256": sha256_file(partial),
                "bytes": partial.stat().st_size,
                "plaintextBytes": plain_size,
                "encryption": "age (X25519)",
                # Counts are taken just before and just after the dump: rows can arrive while it
                # runs, so a restored database must land between the two.
                "rowCountsBefore": before,
                "rowCountsAfter": after,
                # Keep this value somewhere the server's administrator cannot edit: it proves the
                # audit log up to this entry was not rewritten afterwards.
                "auditChain": audit_chain,
                "pgDumpTools": run([pg_dump, "--version"]).stdout.strip(),
                **checked,
            }
            mpartial = tmp / (name + MANIFEST_SUFFIX + ".partial")
            mpartial.write_text(json.dumps(manifest, indent=2) + "\n")

            # Manifest first, then the backup: a backup without a manifest is the incomplete state.
            os.replace(mpartial, cfg.backup_dir / (name + MANIFEST_SUFFIX))
            os.replace(partial, final)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

        record_last_run(cfg, "ok", name, manifest)
        log(f"backup written: {name} ({manifest['bytes']} bytes, {manifest['tables']} tables, sha256 {manifest['sha256'][:12]}…)")
        return final


def record_last_run(cfg: Config, status: str, name: str, manifest: Optional[dict] = None, error: str = "") -> None:
    data = {"status": status, "at": dt.datetime.now(dt.timezone.utc).isoformat(), "file": name, "error": error}
    if manifest:
        data.update(bytes=manifest["bytes"], sha256=manifest["sha256"])
    tmp = cfg.backup_dir / ".last_run.json.partial"
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, cfg.backup_dir / "last_run.json")


def list_backups(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir() if BACKUP_NAME.match(p.name))


def do_prune(cfg: Config, dry_run: bool) -> tuple[list[str], list[str]]:
    keep, delete = plan_prune(list_backups(cfg.backup_dir), cfg.policy)
    for name in delete:
        # Belt and braces: plan_prune only returns matching names, but this is the line that deletes.
        if not BACKUP_NAME.match(name):
            raise BackupError(f"refusing to delete {name!r}: not a backup file")
        log(f"{'would delete' if dry_run else 'deleting'} {name}")
        if not dry_run:
            (cfg.backup_dir / name).unlink(missing_ok=True)
            (cfg.backup_dir / (name + MANIFEST_SUFFIX)).unlink(missing_ok=True)
    log(f"retention: keeping {len(keep)}, {'would delete' if dry_run else 'deleted'} {len(delete)}")

    # Whatever the retention policy says, never let the folder outgrow its budget.
    def size_of(name: str) -> int:
        manifest = cfg.backup_dir / (name + MANIFEST_SUFFIX)
        return (cfg.backup_dir / name).stat().st_size + (manifest.stat().st_size if manifest.exists() else 0)

    surviving = {n: size_of(n) for n in keep if (cfg.backup_dir / n).exists()}
    over, still_over = enforce_budget(surviving, cfg.policy, cfg.max_total_bytes)
    for name in over:
        log(f"{'would delete' if dry_run else 'deleting'} {name} (over the {cfg.max_total_bytes // (1024 * 1024)} MB budget)")
        if not dry_run:
            (cfg.backup_dir / name).unlink(missing_ok=True)
            (cfg.backup_dir / (name + MANIFEST_SUFFIX)).unlink(missing_ok=True)
    remaining = sum(surviving.values()) - sum(surviving[n] for n in over)
    log(f"space: backups use {remaining / (1024 * 1024):.1f} MB of a {cfg.max_total_bytes // (1024 * 1024)} MB budget")
    if still_over:
        log("WARNING: still over budget with only protected backups left (newest two and year-end copies); "
            "raise BACKUP_MAX_TOTAL_MB or review what is being kept")
    keep = [n for n in keep if n not in over]
    delete = delete + over
    return keep, delete


def do_check(cfg: Config, max_age_hours: float, now: Optional[dt.datetime] = None) -> None:
    """For a monitor: succeeds only if there is a recent backup whose files still match their manifest."""
    now = now or dt.datetime.now(dt.timezone.utc)
    names = list_backups(cfg.backup_dir)
    if not names:
        raise BackupError("no backups found")
    newest = names[-1]
    age = now - parse_backup_time(newest)  # type: ignore[operator]
    if age > dt.timedelta(hours=max_age_hours):
        raise BackupError(f"newest backup {newest} is {age.total_seconds() / 3600:.1f} h old (limit {max_age_hours} h)")
    mpath = cfg.backup_dir / (newest + MANIFEST_SUFFIX)
    if not mpath.is_file():
        raise BackupError(f"{newest} has no manifest")
    manifest = json.loads(mpath.read_text())
    actual = sha256_file(cfg.backup_dir / newest)
    if actual != manifest["sha256"]:
        raise BackupError(f"{newest} does not match its manifest (file changed or damaged)")
    log(f"ok: {newest}, {age.total_seconds() / 3600:.1f} h old, checksum matches")


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--env-file", type=Path, default=Path("/opt/smartvie-pm/.env"))
    ap.add_argument("--config", type=Path, default=Path("/opt/smartvie-backups/backup.conf"))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run")
    pr = sub.add_parser("prune"); pr.add_argument("--dry-run", action="store_true")
    ck = sub.add_parser("check"); ck.add_argument("--max-age-hours", type=float, default=26)
    sub.add_parser("audit")
    sub.add_parser("list")
    args = ap.parse_args(argv)

    try:
        cfg = Config.load(args.env_file, args.config)
    except ConfigError as e:
        print(f"configuration error: {e}", file=sys.stderr)
        return 2

    try:
        if args.cmd == "run":
            try:
                path = do_run(cfg)
            except Exception as e:
                with contextlib.suppress(Exception):
                    record_last_run(cfg, "failed", "", error=str(e)[:300])
                notify(cfg, "failed", str(e)[:300])
                raise
            # Only a fully successful backup may prune anything.
            do_prune(cfg, dry_run=False)
            notify(cfg, "ok", f"backup {path.name} written", file=path.name)
        elif args.cmd == "prune":
            do_prune(cfg, dry_run=args.dry_run)
        elif args.cmd == "check":
            failure = None
            try:
                do_check(cfg, args.max_age_hours)
            except BackupError as e:
                notify(cfg, "stale", str(e)[:300])
                failure = e
            try:
                do_audit_check(cfg)
            except BackupError as e:
                notify(cfg, "audit_chain_broken" if isinstance(e, AuditChainError) else "audit_check_failed", str(e)[:300])
                failure = failure or e
                log(f"FAILED: {e}")
            if failure:
                raise failure
        elif args.cmd == "audit":
            try:
                do_audit_check(cfg)
            except BackupError as e:
                notify(cfg, "audit_chain_broken" if isinstance(e, AuditChainError) else "audit_check_failed", str(e)[:300])
                raise
        elif args.cmd == "list":
            keep, _ = plan_prune(list_backups(cfg.backup_dir), cfg.policy)
            for n in list_backups(cfg.backup_dir):
                size = (cfg.backup_dir / n).stat().st_size
                print(f"{n}  {size:>10} bytes  {'keep' if n in keep else 'prune next run'}")
        return 0
    except BackupError as e:
        log(f"FAILED: {e}")
        return 1
    except Exception as e:  # noqa: BLE001 — surface anything unexpected as a failed run, not a traceback in cron mail
        log(f"FAILED (unexpected): {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
