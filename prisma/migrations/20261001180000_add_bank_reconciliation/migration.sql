-- CreateEnum
CREATE TYPE "ReconciliationMethod" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "statement_lines" ADD COLUMN     "reconciliationId" TEXT;

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "method" "ReconciliationMethod" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciled_journal_lines" (
    "journalLineId" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,

    CONSTRAINT "reconciled_journal_lines_pkey" PRIMARY KEY ("journalLineId")
);

-- CreateIndex
CREATE INDEX "bank_reconciliations_bankAccountId_createdAt_idx" ON "bank_reconciliations"("bankAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "reconciled_journal_lines_reconciliationId_idx" ON "reconciled_journal_lines"("reconciliationId");

-- CreateIndex
CREATE INDEX "statement_lines_reconciliationId_idx" ON "statement_lines"("reconciliationId");

-- AddForeignKey
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciled_journal_lines" ADD CONSTRAINT "reconciled_journal_lines_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciled_journal_lines" ADD CONSTRAINT "reconciled_journal_lines_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─── Reconciliation rules ────────────────────────────────────────────────────
-- What src/lib/accounting/reconciliation.ts relies on, repeated where no code
-- path can get around it. A reconciliation links statement lines to posted
-- journal lines on the same bank's ledger account; the two sides must come
-- to the same amount; a journal line is reconciled at most once (its primary
-- key). Nothing here changes the ledger.

ALTER TABLE "statement_lines"
  ADD CONSTRAINT "statement_lines_reconciled_check"
    CHECK (("reconciledAt" IS NULL) = ("reconciliationId" IS NULL));

-- Statement lines stay what the bank said; joining or leaving a
-- reconciliation is now the only change allowed (replaces the Phase 3 guard).
CREATE OR REPLACE FUNCTION "statement_lines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unchanged "statement_lines"%ROWTYPE;
  rec_bank text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."reconciledAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A reconciled statement line cannot be removed';
    END IF;
    RETURN OLD;
  END IF;

  unchanged := NEW;
  unchanged."reconciledAt" := OLD."reconciledAt";
  unchanged."reconciliationId" := OLD."reconciliationId";
  IF unchanged IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Statement lines are what the bank said: they are not edited';
  END IF;

  IF NEW."reconciliationId" IS NOT NULL AND NEW."reconciliationId" IS DISTINCT FROM OLD."reconciliationId" THEN
    IF OLD."reconciliationId" IS NOT NULL THEN
      RAISE EXCEPTION 'This statement line is already reconciled; unmatch it first';
    END IF;
    SELECT "bankAccountId" INTO rec_bank FROM "bank_reconciliations" WHERE "id" = NEW."reconciliationId";
    IF rec_bank IS DISTINCT FROM NEW."bankAccountId" THEN
      RAISE EXCEPTION 'A statement line can only be reconciled within its own bank account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Only a posted line on this bank's own ledger account can be matched.
CREATE FUNCTION "reconciled_journal_lines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_account text;
  entry_status "JournalStatus";
  bank_ledger text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Reconciled journal lines are not edited; unmatch and match again';
  END IF;
  SELECT l."accountId", e."status" INTO line_account, entry_status
    FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
   WHERE l."id" = NEW."journalLineId";
  SELECT b."ledgerAccountId" INTO bank_ledger
    FROM "bank_reconciliations" r JOIN "bank_accounts" b ON b."id" = r."bankAccountId"
   WHERE r."id" = NEW."reconciliationId";
  IF entry_status IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted journal can be reconciled';
  END IF;
  IF line_account IS DISTINCT FROM bank_ledger THEN
    RAISE EXCEPTION 'That journal line is not on this bank account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "reconciled_journal_lines_guard"
  BEFORE INSERT OR UPDATE ON "reconciled_journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "reconciled_journal_lines_guard"();

-- The two sides of a reconciliation are the same money. Checked at commit,
-- so a reconciliation and its lines can be written in any order, and checked
-- whenever either side changes. A reconciliation deleted by unmatching is
-- skipped.
CREATE FUNCTION "check_reconciliation_balance"(rec_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  bank_side numeric;
  book_side numeric;
  bank_lines integer;
  book_lines integer;
BEGIN
  IF rec_id IS NULL OR NOT EXISTS (SELECT 1 FROM "bank_reconciliations" WHERE "id" = rec_id) THEN
    RETURN;
  END IF;
  SELECT count(*), COALESCE(sum("amount"), 0) INTO bank_lines, bank_side
    FROM "statement_lines" WHERE "reconciliationId" = rec_id;
  SELECT count(*), COALESCE(sum(l."debit" - l."credit"), 0) INTO book_lines, book_side
    FROM "reconciled_journal_lines" r JOIN "journal_lines" l ON l."id" = r."journalLineId"
   WHERE r."reconciliationId" = rec_id;
  IF bank_lines = 0 OR book_lines = 0 THEN
    RAISE EXCEPTION 'A reconciliation needs statement lines and book entries';
  END IF;
  IF bank_side <> book_side THEN
    RAISE EXCEPTION 'The statement (%) and the books (%) do not agree', bank_side, book_side;
  END IF;
END;
$$;

CREATE FUNCTION "reconciliation_balance_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'bank_reconciliations' THEN
    PERFORM "check_reconciliation_balance"(NEW."id");
  ELSIF TG_TABLE_NAME = 'reconciled_journal_lines' THEN
    PERFORM "check_reconciliation_balance"(COALESCE(NEW."reconciliationId", OLD."reconciliationId"));
  ELSE
    PERFORM "check_reconciliation_balance"(NEW."reconciliationId");
    IF OLD."reconciliationId" IS DISTINCT FROM NEW."reconciliationId" THEN
      PERFORM "check_reconciliation_balance"(OLD."reconciliationId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "bank_reconciliations_balance"
  AFTER INSERT ON "bank_reconciliations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "reconciliation_balance_check"();

CREATE CONSTRAINT TRIGGER "reconciled_journal_lines_balance"
  AFTER INSERT OR DELETE ON "reconciled_journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "reconciliation_balance_check"();

CREATE CONSTRAINT TRIGGER "statement_lines_reconciliation_balance"
  AFTER UPDATE OF "reconciliationId" ON "statement_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "reconciliation_balance_check"();
