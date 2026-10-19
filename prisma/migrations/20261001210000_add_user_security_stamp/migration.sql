-- A per-user value that is copied into the session token at sign-in and
-- changed whenever the user's role, active flag or password changes (or on
-- "sign out everywhere"). A session whose token no longer carries the current
-- value is refused, so access can be withdrawn immediately instead of when the
-- token next happens to be re-checked.
--
-- Existing rows each get their own random value. The default is dropped again
-- straight away: the application supplies the value (Prisma's uuid() default
-- is client-side), and keeping a database default would show up as drift.
ALTER TABLE "users" ADD COLUMN "securityStamp" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "users" ALTER COLUMN "securityStamp" DROP DEFAULT;
