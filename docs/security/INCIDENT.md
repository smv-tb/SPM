# Incident runbook

For when something is wrong or might be: a lost laptop, a leaked secret, a
suspicious sign-in, an alert from the security webhook. Read the first section,
then jump to the step you need. Nothing here needs the app to be healthy.

Placeholders: `<app-server>` is the host in `SSH_HOST`, `$REMOTE_DIR` is
`/opt/smartvie-pm`. The server `.env` lives in `$REMOTE_DIR`.

## First ten minutes

1. **Write down the time and what you saw.** Do not tidy up yet.
2. **Take a backup now**, before changing anything:
   `ssh root@<app-server> python3 /opt/smartvie-backups/bin/smartvie_backup.py run`
3. **Look at the audit log** (the `audit_logs` table; there is no screen for it yet) for what
   changed and who did it. Sign-ins, lockouts, user/role changes, bank-detail
   changes and MFA resets are all recorded.
4. **Contain**, using the smallest step that works:

| Suspicion | Do this |
|---|---|
| One account is compromised | Deactivate or change the role of that user in Settings → Team. That rotates their security stamp, so every session of theirs ends on its next request. Then reset their password and, if needed, their second factor. |
| Any session may be stolen | Rotate `AUTH_SECRET` (below). Everyone is signed out. |
| The Hermes token leaked | Rotate `HERMES_API_TOKEN` (below). |
| Someone may be changing the books | Freeze the books (below). |
| The server itself is compromised | Treat every secret in `.env` as leaked and rotate all of them; restore onto a clean host. |

## Rotating secrets

Every rotation is: change the value in the server `.env`, redeploy
(`./deploy.sh`, or `docker compose up -d` on the server), check the app signs in.
Keep the previous `.env` as `.env.before-<date>` (mode 0600) until you are sure,
then delete it.

### `AUTH_SECRET` (ends every session)

    openssl rand -base64 32

Put the output in `AUTH_SECRET`. Every existing token stops verifying, so all
users must sign in again. Nothing is lost. Do this first when in doubt.

### `HERMES_API_TOKEN`

    openssl rand -hex 32

Put it in `HERMES_API_TOKEN`, redeploy, then update the agent that uses it.
Sessions held in memory die with the restart. Until scoped tokens exist (S4)
this one token can read and write everything Hermes covers, so rotate it
whenever the machine that holds it is lost.

### `DATA_ENCRYPTION_KEYS`

This ring encrypts authenticator secrets and bank account numbers. **Never
replace it and never delete a key that still protects data**: those values
become unreadable (authenticator secrets are lost; bank numbers must be
re-typed).

To rotate, add a new key *in front*:

    DATA_ENCRYPTION_KEYS=k2:<new base64>,k1:<old base64>

New writes use `k2`; old values still open with `k1`. Authenticator secrets are
re-saved under the newest key the next time each user signs in with a code.
Bank numbers keep their old key until they are saved again. Remove `k1` only
once nothing uses it. Back the whole ring up (password manager) before and
after every change. If a key is *leaked* rather than just old, rotate as above
and re-enter the bank details in Books → Settings, which re-seals them.

### Database passwords

Production uses three roles (see [DB-ROLES.md](DB-ROLES.md)): the app role
(`DATABASE_URL`), the owner used for migrations (`MIGRATION_DATABASE_URL`) and a
read-only backup role (`BACKUP_DATABASE_URL`, in `/opt/smartvie-backups/backup.conf`).

1. On the database host, as a superuser: `ALTER ROLE <role> PASSWORD '<new>'`
   (for the app role, re-run `deploy/db/app-role.sql` with the new password).
2. Update the matching URL in `.env` or `backup.conf`.
3. Redeploy, then **run a backup by hand** to prove the backup role still works.

### Other

- `SECURITY_ALERT_WEBHOOK_SECRET`: change it here and in the receiver (n8n) together.
- Backup key: see [BACKUPS.md](BACKUPS.md). Old backups still need the old private key.
- SSH keys: remove the old public key from `~/.ssh/authorized_keys` on the server.

## Freezing the books

If someone may be posting or editing financial records, stop all posting first
and investigate second:

1. In Books → Settings, set the **lock date** to today. Posting on or before the
   lock date is refused by the service and by the database.
2. Deactivate the suspect account(s) (above).
3. Compare the audit log and the audit chain check (`audit_chain_check()`, or the
   daily backup `check`) with the last good backup. A broken chain means rows
   were altered outside the app.

Posted journals are immutable, so damage is corrected with reversals, never
edits. To unfreeze, move the lock date back. Re-opening closed books is an
Admin action with a recorded reason and a second-factor check.

## Restoring from backup

Full steps are in [BACKUPS.md](BACKUPS.md). In short:

1. Fetch the backup file and the **private key** (it is never on the server).
2. Decrypt with `age`, then restore into a **new** database with
   `pg_restore --no-owner --no-privileges`, never over the live one first.
3. Re-run `deploy/db/app-role.sql` so the app role has its rights.
4. Point `DATABASE_URL` at it, run `prisma migrate deploy`, start the app.
5. Check the audit chain and the trial balance, then tell users what period of
   data was lost (everything since the backup).

Restoring is a decision to make with a clear head and a second pair of eyes. If
unsure, freeze the books and restore into a scratch database first, as the
monthly restore drill does.

## Afterwards

- Write a short account: timeline, cause, what was exposed, what was done.
- If personal data was exposed, check whether the ICO must be told (within 72
  hours of becoming aware). [PRIVACY.md](PRIVACY.md) lists what personal data we hold.
- Fix the cause, and add a test or a check so it cannot quietly return.
- Remove the temporary access you granted yourself during the incident.
