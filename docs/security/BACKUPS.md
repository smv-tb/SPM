# Backups

## What happens

On the **1st of every month at 02:30** (server time) the server dumps the
production database, checks the dump, encrypts it with a **public** key, and
prunes old copies. **Take one by hand before any risky change** (a big deploy, a
migration, the 1 November switch-over): it takes a second —
`ssh root@<app-server> python3 /opt/smartvie-backups/bin/smartvie_backup.py run`.

| | |
|---|---|
| Where | `/opt/smartvie-backups/` on the app server (root only, mode 0700) |
| Files | `smartvie_pm-YYYYMMDD-HHMMSS.dump.age` + `….manifest.json` (checksum, size, row counts) |
| Schedule | `/etc/cron.d/smartvie-backup`: `run` on the 1st at 02:30; `check` daily at 08:15 (fails if the newest backup is over 35 days old) |
| Log | `/var/log/smartvie-backup.log` (rotated weekly, 12 weeks) |
| Retention | the newest 2, then 12 months, plus the last backup of each of the **7 most recent financial years** (year ends 31 October; `BACKUP_YEAR_END_MONTH` in `backup.conf`) — about 20 files at most |
| Size | ~300 KB each today |

The database itself lives on another machine (`<db-host>`), so a snapshot of
the app server does **not** contain it. This job is what carries the data onto
the server, and the existing off-site copy of the server then carries it
off-site.

## The key — read this

The dumps are encrypted with [age](https://age-encryption.org). **Only the public
key is on the server** (`BACKUP_AGE_RECIPIENT` in `backup.conf`), so someone who
steals the server, the backups or the off-site SSD cannot read them.

The **private key** is the only way to read a backup:

    ~/.smartvie-backup/identity.txt   (on the machine that set this up)

* **Keep at least two copies in different places** (a password manager, plus
  printed or on a USB stick in a safe). If every copy is lost, every backup is
  unreadable — encryption cannot be undone.
* **Never put it on the server.** `install.sh` and the script both refuse a
  private key as the recipient.
* To change keys: generate a new pair, put the new *public* key in
  `backup.conf`; old backups still need the old private key — keep it.

## Check it is working (30 seconds, any time)

    ssh root@<app-server> 'python3 /opt/smartvie-backups/bin/smartvie_backup.py list; python3 /opt/smartvie-backups/bin/smartvie_backup.py check; tail -5 /var/log/smartvie-backup.log'

`check` fails if the newest backup is over 35 days old, missing its manifest,
or no longer matches its checksum. **A failed night does not alert anyone by
itself** unless `BACKUP_WEBHOOK_URL` (e.g. an n8n webhook) is set in
`backup.conf`; otherwise you only find out by running the command above or
reading the log. A failed run never deletes any older backup.

## It cannot fill the disk

Whatever the schedule, these limits are enforced on **every** run (values in
`backup.conf`, in MB):

| Limit | Default | What happens |
|---|---|---|
| `BACKUP_MAX_TOTAL_MB` | 200 | Everything this job keeps stays under this. Over it, the **oldest** go first; the **newest two** and the **year-end copies** are never dropped (the run logs a warning instead). Today it uses ~0.3 MB. |
| `BACKUP_MIN_FREE_MB` | 1024 | The disk must stay at least this free. Checked before starting and again once the dump size is known (the plaintext and encrypted copies briefly coexist, ~2x). Too tight → the run stops and writes nothing. |
| `BACKUP_MAX_DUMP_MB` | 1024 | A single dump larger than this is refused: it would mean something grew unexpectedly, so look before raising it. |

Each run logs `space: backups use X MB of a Y MB budget`. A refused run leaves
no partial files, and never deletes older backups.

*Monthly means up to a month of changes can be lost in a disaster.* That is
fine only if you accept it; the space cost of running nightly instead is
negligible (the limits above still apply). Switch with
`deploy/backup/install.sh --schedule nightly` (and set `BACKUP_KEEP_DAILY=7`,
`BACKUP_KEEP_WEEKLY=4`).

## Monthly: prove it restores

A backup nobody has restored is a hope. Once a month, **on a machine that has
the private key** and PostgreSQL's server programs (`initdb`, `pg_ctl`):

    scp root@<app-server>:'/opt/smartvie-backups/smartvie_pm-*.dump.age*' ./some-private-dir/
    python3 deploy/backup/restore_drill.py ./some-private-dir/smartvie_pm-<newest>.dump.age \
        --identity ~/.smartvie-backup/identity.txt

It decrypts into a private temp folder, restores into a throwaway database on a
spare port, runs the checks below, and deletes everything (including the
decrypted copy). Delete the encrypted copies you fetched when done. **All checks
must pass.**

* checksum matches the manifest; decrypts; restores with no errors
* migration count and row counts (users, audit log, journals, invoices) match the manifest
* every posted journal balances; journal numbers have no gaps
* the audit log still refuses updates and deletes

## Real recovery (the database is lost)

1. Fetch the newest good backup (and its manifest) from `/opt/smartvie-backups/`
   or the off-site copy.
2. On a machine with the private key and PostgreSQL 15 tools:

       age -d -i ~/.smartvie-backup/identity.txt -o dump smartvie_pm-<…>.dump.age
       createdb smartvie_pm
       pg_restore --no-owner --no-privileges -d smartvie_pm dump
       rm dump                       # it is the unencrypted data

3. Point `DATABASE_URL` in the server's `.env` at it and redeploy (`./deploy.sh`);
   startup applies any migrations the backup predates.
4. Anything posted since the backup (up to a day) is gone: re-enter it from
   source documents. The ledger has gapless numbers, so a missing range is visible.

## What the script refuses to do (so a bad night can't make things worse)

* It verifies the dump **before** encrypting (afterwards this server can't read
  it) and writes nothing if that fails. The first real run caught this: it
  refused rather than store a backup it couldn't verify.
* A failed run never prunes. Pruning only ever touches files named exactly
  `smartvie_pm-<date>-<time>.dump.age` (and their manifests).
* It uses the PostgreSQL client tools that match the **server's** major version
  (15), not whichever the OS wrapper picks — Debian's wrapper chose 17 when
  connection variables were set, which wrote an archive 15 can't read.
* One run at a time (a file lock); the plaintext dump exists only inside a
  private temp folder and is deleted the moment it is encrypted.

## Install / update

    deploy/backup/install.sh          # from your machine; runs the tests first, then installs

Safe to re-run; it never overwrites `backup.conf` and never touches other
applications' cron jobs. It verifies the cron file it writes (cron silently ignores
a malformed one). Tests: `yarn test:backup`.

## Not covered

* **Immutability.** Anything that can reach the server (or the machine copying
  its disk) can delete the backups. An append-only / object-lock store would
  prevent that; the current off-site SSD copy does not.
* **Alerting** is opt-in (webhook) — see above.
* The database host (`<db-host>`) has its own failure modes; this job covers
  *data*, not that machine's configuration.

## Database credential for the backup

The backup reads `DATABASE_URL` from the app's `.env`. If the application uses a
least-privilege database role (see [`DB-ROLES.md`](DB-ROLES.md)), that role cannot
dump the migration history, so set `BACKUP_DATABASE_URL` (in `backup.conf`, beside the other
backup settings) to the read-only backup role instead. It takes precedence when set.
The installed script must be recent enough to know about it: re-run
`deploy/backup/install.sh` after upgrading, because `deploy.sh` does not update
`/opt/smartvie-backups/bin/smartvie_backup.py`.

## Audit-log chain check (S3.3)

The daily `check` job also verifies the audit log's hash chain (`audit_chain_check()` in the database)
and records its head in `/opt/smartvie-backups/audit_head.json`. It fails, and sends an
`audit_chain_broken` alert to `BACKUP_WEBHOOK_URL`, if an entry was changed, removed or inserted, if the
log is shorter than the last recorded head, or if the entry at that head no longer has the recorded hash.
Run it by hand with `smartvie_backup.py audit`. Every backup manifest carries `auditChain`
(`rows`, `headSeq`, `headHash`); a monthly backup refuses to run on a broken chain.

Someone who controls the database can rebuild the whole chain, so for the check to mean anything
against them, copy a manifest's `auditChain.headHash` somewhere they can't edit (your own notes, an
email to yourself) from time to time. After changing the backup script, re-run `deploy/backup/install.sh`.
