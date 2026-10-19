# Resetting someone's two-factor sign-in without the app

**Normally** an administrator does this in the app: *Settings → Admin → Users →
edit the person → Reset two-factor sign-in*. That route refuses to act on your
own account (so a stolen admin session can't switch off its own second step).

Use this procedure only when the app can't do it — typically **the only
administrator has lost their phone**. It needs shell access to the database
host, so it is as trusted as the server itself.

## What it does

The same as the app, in one transaction: deletes the user's recovery codes,
clears their authenticator secret, changes their security stamp (which ends
every session they have), and writes an audit row naming the reason and marking
the actor as `SYSTEM`. They can then sign in with their password alone and set
two-factor up again.

## Steps

1. Take a backup first if you have any doubt (`pg_dump -Fc …`).
2. Connect with `psql` to the application database and run, changing the two
   values on the first lines:

```sql
\set email  'admin@example.com'
\set reason 'Sole administrator lost their phone; reset by <your name> on <date>'

BEGIN;

WITH target AS (
  SELECT id, email, "totpEnabledAt" IS NOT NULL AS was_on
  FROM users WHERE lower(email) = lower(:'email')
), cleared AS (
  DELETE FROM recovery_codes WHERE "userId" IN (SELECT id FROM target)
), changed AS (
  UPDATE users
  SET "totpSecretEnc" = NULL, "totpEnabledAt" = NULL, "totpLastUsedStep" = NULL,
      "securityStamp" = gen_random_uuid()::text
  WHERE id IN (SELECT id FROM target)
  RETURNING id
)
-- "occurredAt" is a UTC timestamp without a zone, and the column default would
-- fill in the server's local time (an hour out in summer), so say UTC explicitly.
INSERT INTO audit_logs (id, "occurredAt", "actorType", "actorLabel", action, "entityType", "entityId", before, after, reason)
SELECT gen_random_uuid()::text, (now() AT TIME ZONE 'utc'), 'SYSTEM', 'manual database reset', 'mfa.disable', 'User', t.id,
       jsonb_build_object('mfa', t.was_on), jsonb_build_object('mfa', false), :'reason'
FROM target t;

-- Expect "INSERT 0 1". If it says "INSERT 0 0" the email matched no user: ROLLBACK and check the spelling.
COMMIT;
```

3. Ask the person to sign in with their password, then set two-factor up again
   under *Settings → Security*. If it is a different person's account, an
   administrator can do this in the app instead.

## Afterwards

Check the audit log shows the `mfa.disable` row with your reason:

```sql
SELECT "occurredAt", "actorLabel", reason FROM audit_logs
WHERE action = 'mfa.disable' ORDER BY "occurredAt" DESC LIMIT 3;
```
