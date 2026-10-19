-- Set when an administrator (or the Hermes agent) creates a user or resets
-- someone else's password: that person has been handed a password they did not
-- choose, and must replace it before doing anything else. Cleared when they
-- change it themselves.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
