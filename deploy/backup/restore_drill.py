#!/usr/bin/env python3
"""
Restore drill: prove a backup can actually be restored, and that what comes back
is consistent. Run it monthly, and after any change to the backup setup.

    restore_drill.py BACKUP.dump.age --identity ~/.smartvie-backup/identity.txt

Run it on a machine that has the PRIVATE key (not the server — the key is kept
off it on purpose) and PostgreSQL's server programs (initdb, pg_ctl) plus
psql, pg_restore and age. It never touches the real database: it decrypts to a
private temp directory, starts a throwaway cluster on a spare local port,
restores into it, checks, and then deletes everything, including the decrypted
copy.

Checks (all must pass):
  * the file's checksum matches its manifest (not damaged or swapped)
  * it decrypts with the key, and pg_restore loads it without errors
  * the migration count and key row counts match the manifest
  * every posted journal balances (debits = credits) and journal numbers have no gaps
  * the audit log still refuses updates and deletes (its trigger survived)
  * the restored database actually answers a query the application would run

Exit status 0 only if every check passed.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from smartvie_backup import MANIFEST_SUFFIX, sha256_file  # noqa: E402


def run(cmd, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.passed = 0

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        if ok:
            self.passed += 1
            print(f"  pass  {label}")
        else:
            self.failures.append(label)
            print(f"  FAIL  {label}{' — ' + detail if detail else ''}")
        return ok


def counts_within(restored: int, before: int, after: int) -> bool:
    """Rows can arrive while a dump runs, so a restored count must lie between the two readings."""
    return min(before, after) <= restored <= max(before, after)


def drill(backup: Path, identity: Path, manifest_path: Optional[Path], keep: bool = False) -> int:
    report = Report()
    for tool in ("age", "pg_restore", "psql", "initdb", "pg_ctl"):
        if not shutil.which(tool):
            print(f"error: '{tool}' is not installed or not on PATH", file=sys.stderr)
            return 2
    if not backup.is_file() or not identity.is_file():
        print("error: backup or identity file not found", file=sys.stderr)
        return 2

    manifest_path = manifest_path or backup.with_name(backup.name + MANIFEST_SUFFIX)
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else None

    print(f"Restore drill for {backup.name}")
    report.check("a manifest sits next to the backup", manifest is not None)
    if manifest:
        report.check("the file matches its manifest checksum (not damaged or swapped)", sha256_file(backup) == manifest.get("sha256"))

    os.umask(0o077)
    work = Path(tempfile.mkdtemp(prefix="smartvie-drill-"))
    cluster = work / "pgdata"
    started = False
    port = free_port()
    pg_env = {**os.environ, "PGHOST": "127.0.0.1", "PGPORT": str(port), "PGUSER": "drill", "PGDATABASE": "drill"}
    pg_env.pop("PGPASSWORD", None)

    def sql(query: str) -> str:
        p = run(["psql", "-X", "-At", "-c", query], env=pg_env)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip()[:300])
        return p.stdout.strip()

    try:
        plain = work / "dump"
        p = run(["age", "-d", "-i", str(identity), "-o", str(plain), str(backup)])
        if not report.check("it decrypts with the private key", p.returncode == 0, p.stderr.strip()[:200]):
            return 1

        p = run(["initdb", "-D", str(cluster), "-U", "drill", "--auth=trust", "-E", "UTF8", "--no-sync"], env={**os.environ, "LC_ALL": "C"})
        if p.returncode != 0:
            print(p.stderr, file=sys.stderr)
            return 2
        p = run(["pg_ctl", "-D", str(cluster), "-l", str(work / "pg.log"), "-w", "-o",
                 f"-p {port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off", "start"],
                env={**os.environ, "LC_ALL": "C"})
        if p.returncode != 0:
            print(p.stderr or p.stdout, file=sys.stderr)
            return 2
        started = True
        run(["createdb"], env=pg_env)

        # --no-owner/--no-privileges: the original roles don't exist here, and ownership isn't what is being checked.
        p = run(["pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "-d", "drill", str(plain)], env=pg_env)
        if not report.check("pg_restore loads it with no errors", p.returncode == 0, p.stderr.strip()[:300]):
            return 1

        try:
            check_restored(report, sql, manifest)
        except RuntimeError as e:
            report.check("the restored database answers queries", False, str(e))
    finally:
        if started:
            run(["pg_ctl", "-D", str(cluster), "-m", "immediate", "stop"], env={**os.environ, "LC_ALL": "C"})
        if keep:
            print(f"(kept {work})")
        else:
            shutil.rmtree(work, ignore_errors=True)  # includes the decrypted copy

    print(f"\n{report.passed} passed, {len(report.failures)} failed")
    for f in report.failures:
        print(f"  - {f}")
    return 0 if not report.failures else 1


def check_restored(report: Report, sql: Callable[[str], str], manifest: Optional[dict]) -> None:
    report.check("the restored database answers a normal query", sql("SELECT count(*) FROM users") != "")

    unfinished = int(sql("SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL"))
    report.check("no migration was left half-applied", unfinished == 0, f"{unfinished} unfinished")

    if manifest:
        before, after = manifest.get("rowCountsBefore", {}), manifest.get("rowCountsAfter", {})
        queries = {
            "users": "SELECT count(*) FROM users",
            "audit_logs": "SELECT count(*) FROM audit_logs",
            "journal_entries": "SELECT count(*) FROM journal_entries",
            "invoices": "SELECT count(*) FROM invoices",
            "migrations": "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL",
        }
        for key, query in queries.items():
            got = int(sql(query))
            ok = key in before and key in after and counts_within(got, before[key], after[key])
            report.check(f"{key}: {got} rows matches the manifest ({before.get(key)}..{after.get(key)})", ok)

    unbalanced = int(sql("""
        SELECT count(*) FROM (
          SELECT l."entryId" FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
          WHERE e.status = 'POSTED'  -- a reversal is its own POSTED entry, not a status
          GROUP BY l."entryId" HAVING sum(l.debit) <> sum(l.credit)) x"""))
    report.check("every posted journal balances (debits = credits)", unbalanced == 0, f"{unbalanced} unbalanced")

    posted = sql("SELECT count(number) || ',' || coalesce(max(number),0) FROM journal_entries WHERE number IS NOT NULL")
    n, top = (int(x) for x in posted.split(","))
    report.check("journal numbers have no gaps", n == top, f"{n} numbered, highest is {top}")

    triggers = int(sql("SELECT count(*) FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal"))
    report.check("the audit log still has its append-only triggers", triggers >= 2, f"{triggers} found")

    refused = True
    if int(sql("SELECT count(*) FROM audit_logs")) > 0:
        try:
            sql("""DO $$ BEGIN
                     UPDATE audit_logs SET action = action WHERE id = (SELECT id FROM audit_logs LIMIT 1);
                     RAISE EXCEPTION 'NOT_REFUSED';
                   EXCEPTION WHEN OTHERS THEN
                     IF SQLERRM = 'NOT_REFUSED' THEN RAISE; END IF;
                   END $$""")
        except RuntimeError:
            refused = False
    report.check("and it still refuses to change an audit row", refused)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("backup", type=Path)
    ap.add_argument("--identity", type=Path, required=True, help="age private key file (kept off the server)")
    ap.add_argument("--manifest", type=Path, default=None)
    ap.add_argument("--keep", action="store_true", help="keep the throwaway directory for inspection (it contains decrypted data)")
    args = ap.parse_args()
    return drill(args.backup, args.identity, args.manifest, args.keep)


if __name__ == "__main__":
    sys.exit(main())
