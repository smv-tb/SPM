-- Tamper evidence for the audit log (S3.3).
--
-- Every row carries `chainSeq` (its place in one global order), `prevHash` (the
-- previous row's hash) and `hash` (SHA-256 over this row's content plus
-- prevHash). Changing, removing or inserting a row anywhere breaks every hash
-- after it, so `audit_chain_check()` finds it. The chain is built by a BEFORE
-- INSERT trigger so no code path (app, Hermes, a script, psql) can skip it.
--
-- The defaults exist only so Prisma's schema matches; the trigger always
-- overwrites whatever an insert supplies.
ALTER TABLE "audit_logs"
  ADD COLUMN "chainSeq" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "prevHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "hash" TEXT NOT NULL DEFAULT '';

-- Canonical text of a row: a JSON array in a fixed field order. jsonb prints
-- keys in a fixed order and numbers/strings unambiguously, so the same row
-- always gives the same text.
CREATE FUNCTION "audit_logs_row_hash"(r "audit_logs", seq BIGINT, prev TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    prev || '|' || jsonb_build_array(
      seq, r."id", to_char(r."occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      r."actorType"::text, r."actorId", r."actorLabel", r."action",
      r."entityType", r."entityId", r."before", r."after", r."reason", r."ipAddress"
    )::text, 'UTF8')), 'hex')
$$;

-- One writer at a time extends the chain; the lock is held to commit, so the
-- order of chainSeq is the order rows became visible.
CREATE FUNCTION "audit_logs_chain"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  head_seq BIGINT;
  head_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs_chain'));
  SELECT "chainSeq", "hash" INTO head_seq, head_hash
    FROM "audit_logs" ORDER BY "chainSeq" DESC LIMIT 1;
  NEW."chainSeq" := COALESCE(head_seq, 0) + 1;
  NEW."prevHash" := COALESCE(head_hash, repeat('0', 64));
  NEW."hash" := "audit_logs_row_hash"(NEW, NEW."chainSeq", NEW."prevHash");
  RETURN NEW;
END;
$$;

-- Chain the rows that already exist, oldest first. The append-only trigger is
-- lifted for this one statement block, inside this migration's transaction.
ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_no_update_delete";
DO $$
DECLARE
  r "audit_logs";
  n BIGINT := 0;
  prev TEXT := repeat('0', 64);
  h TEXT;
BEGIN
  FOR r IN SELECT * FROM "audit_logs" ORDER BY "occurredAt", "id" LOOP
    n := n + 1;
    h := "audit_logs_row_hash"(r, n, prev);
    UPDATE "audit_logs" SET "chainSeq" = n, "prevHash" = prev, "hash" = h WHERE "id" = r."id";
    prev := h;
  END LOOP;
END;
$$;
ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_no_update_delete";

CREATE UNIQUE INDEX "audit_logs_chainSeq_key" ON "audit_logs"("chainSeq");

CREATE TRIGGER "audit_logs_chain_insert"
  BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_chain"();

-- Walks the whole chain. `brokenAt` is the first chainSeq whose stored hash,
-- link or position doesn't match (null = intact). Read-only, so the backup role
-- can run it.
CREATE FUNCTION "audit_chain_check"()
RETURNS TABLE ("rows" BIGINT, "headSeq" BIGINT, "headHash" TEXT, "brokenAt" BIGINT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r "audit_logs";
  expected_seq BIGINT := 0;
  prev TEXT := repeat('0', 64);
BEGIN
  "rows" := 0; "headSeq" := 0; "headHash" := prev; "brokenAt" := NULL;
  FOR r IN SELECT * FROM "audit_logs" ORDER BY "chainSeq" LOOP
    expected_seq := expected_seq + 1;
    IF r."chainSeq" <> expected_seq OR r."prevHash" <> prev
       OR r."hash" <> "audit_logs_row_hash"(r, r."chainSeq", prev) THEN
      "brokenAt" := r."chainSeq";
      RETURN NEXT; RETURN;
    END IF;
    prev := r."hash";
    "rows" := "rows" + 1; "headSeq" := r."chainSeq"; "headHash" := r."hash";
  END LOOP;
  RETURN NEXT;
END;
$$;
