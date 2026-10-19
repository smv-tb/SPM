# Database roles (least privilege)

The application only ever reads and writes rows. It never needs to create, alter or
drop anything. So it should not be *able* to: if the app, or its `DATABASE_URL`, is
ever compromised, an attacker with schema rights could drop tables, switch off the
triggers that make posted ledger entries and the audit log tamper-proof, or erase
history. With a rows-only role they cannot.

| Role | Used by | Can |
| --- | --- | --- |
| **owner** (your existing database user) | start-up migrations only (`MIGRATION_DATABASE_URL`) | everything; it owns the schema |
| **app** (`smartvie_app`) | the running application (`DATABASE_URL`) | read, insert, update and delete rows; read and **append to** the audit log (no update, delete or truncate); nothing else |
| **backup** (`smartvie_backup`, optional) | the backup job (`BACKUP_DATABASE_URL`) | read everything, including migration history; write nothing |

The app role cannot `ALTER`, `DROP`, `CREATE` or `TRUNCATE`, cannot disable a trigger
(that needs ownership), cannot read or forge `_prisma_migrations`, and owns nothing.
A table added by a later migration is usable by the app automatically.

## Setting it up

You need one run of [`deploy/db/app-role.sql`](../../deploy/db/app-role.sql), as a
database superuser (or an owner with `CREATEROLE`), connected to the application
database. Your current database user stays as the owner, so nothing is moved.

```bash
psql -d smartvie_pm \
  -v owner_role=smartvie_pm \
  -v app_role=smartvie_app      -v app_password="$(openssl rand -base64 24)" \
  -v backup_role=smartvie_backup -v backup_password="$(openssl rand -base64 24)" \
  -f deploy/db/app-role.sql
```

The backup role is optional (PostgreSQL 14+); leave out `backup_role` and
`backup_password` to skip it. Note the generated passwords: they are not stored
anywhere else. The script is safe to repeat, and repeating it with a new password
rotates that password.

Then, in the server's `.env`:

```bash
DATABASE_URL=postgresql://smartvie_app:<app password>@<db-host>:5432/smartvie_pm?schema=public
MIGRATION_DATABASE_URL=postgresql://smartvie_pm:<owner password>@<db-host>:5432/smartvie_pm?schema=public
```

and, if you made the backup role, in `backup.conf` beside the other backup settings
(see [`BACKUPS.md`](BACKUPS.md)):

```bash
BACKUP_DATABASE_URL=postgresql://smartvie_backup:<backup password>@<db-host>:5432/smartvie_pm
```

Redeploy. The entrypoint runs migrations as the owner and starts the app as the app role.

**Do the backup step too.** The backup job reads `DATABASE_URL` unless
`BACKUP_DATABASE_URL` is set, and the app role cannot dump the migration history, so
`pg_dump` would start failing. Two parts, both needed:

1. Put `BACKUP_DATABASE_URL` in `backup.conf` (above).
2. **Update the installed backup script:** run `deploy/backup/install.sh --recipient <your age public key>`.
   `deploy.sh` copies the source to the server but does *not* update
   `/opt/smartvie-backups/bin/smartvie_backup.py`; an older installed script ignores
   `BACKUP_DATABASE_URL`, falls back to the app role, and the backup fails with
   `permission denied for table _prisma_migrations`. (The public key is the
   `BACKUP_AGE_RECIPIENT` line already in `backup.conf`; `backup.conf` itself is left alone.)

Then run a backup by hand and check it succeeds (the commands are in `BACKUPS.md`).

## Starting without it

If `MIGRATION_DATABASE_URL` is not set, the app keeps working with a single database
user, exactly as before, and the entrypoint prints a warning at every start. It is a
recommended hardening step, not a prerequisite.

## Checking it

Connect as the app role and try something destructive; it must be refused:

```bash
psql "$DATABASE_URL" -c 'DROP TABLE users'                                    # permission denied
psql "$DATABASE_URL" -c 'ALTER TABLE audit_logs DISABLE TRIGGER ALL'          # must be owner
psql "$DATABASE_URL" -c "DELETE FROM audit_logs"                              # permission denied
```

## If something goes wrong

- **The app says "permission denied"** after an upgrade: a migration created something
  the app role has no rights on (for example a table made by a different user than
  `owner_role`). Re-run `app-role.sql`; it re-grants on everything that exists.
- **Break-glass:** set `DATABASE_URL` to the owner URL, redeploy, fix, then switch back.
  Treat that as a deliberate, short-lived exception.
- **Rotating the app password:** re-run the script with a new `app_password`, then
  update `DATABASE_URL` and redeploy.
