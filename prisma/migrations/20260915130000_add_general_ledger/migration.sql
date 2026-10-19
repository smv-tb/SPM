-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "JournalSourceType" AS ENUM ('MANUAL', 'REVERSAL', 'OPENING_BALANCE', 'SYSTEM');

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "legalName" TEXT NOT NULL DEFAULT '',
    "companyNumber" TEXT,
    "vatNumber" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "baseCurrency" TEXT NOT NULL DEFAULT 'GBP',
    "yearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "yearStartDay" INTEGER NOT NULL DEFAULT 1,
    "lockDate" DATE,
    "nextJournalNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "number" INTEGER,
    "date" DATE NOT NULL,
    "reference" TEXT,
    "memo" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" "JournalSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "reversesId" TEXT,
    "createdById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatCode" TEXT,
    "projectId" TEXT,
    "phaseId" TEXT,
    "milestoneId" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_idx" ON "ledger_accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_number_key" ON "journal_entries"("number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversesId_key" ON "journal_entries"("reversesId");

-- CreateIndex
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date");

-- CreateIndex
CREATE INDEX "journal_entries_status_date_idx" ON "journal_entries"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_sourceType_sourceId_key" ON "journal_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_projectId_idx" ON "journal_lines"("projectId");

-- CreateIndex
CREATE INDEX "journal_lines_phaseId_idx" ON "journal_lines"("phaseId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_entryId_lineNumber_key" ON "journal_lines"("entryId", "lineNumber");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Ledger integrity rules ──────────────────────────────────────────────────
-- These repeat the essential rules from src/lib/accounting so that nothing —
-- Hermes, a script, a raw SQL session — can put the books in an invalid state.

ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_singleton_check" CHECK ("id" = 'default'),
  ADD CONSTRAINT "company_settings_year_start_check"
    CHECK ("yearStartMonth" BETWEEN 1 AND 12 AND "yearStartDay" BETWEEN 1 AND 28),
  ADD CONSTRAINT "company_settings_next_number_check" CHECK ("nextJournalNumber" >= 1);

-- A line is a debit or a credit: never both, never neither, never negative.
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_one_side_check"
    CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" = 0) <> ("credit" = 0)));

-- Posted entries always carry a number; drafts never do.
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_number_check" CHECK (("status" = 'POSTED') = ("number" IS NOT NULL));

CREATE FUNCTION "journal_entries_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unchanged    "journal_entries"%ROWTYPE;
  lock_date    date;
  total_debit  numeric;
  total_credit numeric;
  line_count   integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'POSTED' THEN
      RAISE EXCEPTION 'Journals must be created as drafts and then posted';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'POSTED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Journal #% is posted and cannot be deleted; reverse it instead', OLD."number";
    END IF;
    -- The only change allowed to a posted entry is a deleted user's id being
    -- cleared by ON DELETE SET NULL. Who posted it survives in the audit log.
    unchanged := NEW;
    unchanged."createdById" := OLD."createdById";
    unchanged."postedById" := OLD."postedById";
    IF unchanged IS DISTINCT FROM OLD
       OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL)
       OR (NEW."postedById" IS DISTINCT FROM OLD."postedById" AND NEW."postedById" IS NOT NULL) THEN
      RAISE EXCEPTION 'Journal #% is posted and cannot be changed; reverse it instead', OLD."number";
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."status" = 'POSTED' THEN
    SELECT "lockDate" INTO lock_date FROM "company_settings" WHERE "id" = 'default';
    IF lock_date IS NOT NULL AND NEW."date" <= lock_date THEN
      RAISE EXCEPTION 'Journal date % is on or before the lock date %', NEW."date", lock_date;
    END IF;

    SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
      INTO total_debit, total_credit, line_count
      FROM "journal_lines" WHERE "entryId" = NEW."id";
    IF line_count < 2 OR total_debit <> total_credit THEN
      RAISE EXCEPTION 'Journal % does not balance (debits %, credits %, % lines)',
        NEW."id", total_debit, total_credit, line_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_entries_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "journal_entries_guard"();

-- Lines of a posted entry are frozen. When a draft is deleted its lines cascade
-- after the parent row is gone, so a missing parent is allowed through.
CREATE FUNCTION "journal_lines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "journal_entries"
    WHERE "status" = 'POSTED'
      AND "id" IN (
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."entryId" END,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."entryId" END
      )
  ) THEN
    RAISE EXCEPTION 'Lines of a posted journal cannot be changed';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "journal_lines_guard"();

-- System accounts are referenced by code from automated postings.
CREATE FUNCTION "ledger_accounts_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isSystem" THEN
      RAISE EXCEPTION 'System account % cannot be deleted', OLD."code";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."isSystem" AND (
    NEW."code" <> OLD."code" OR NEW."type" <> OLD."type" OR NEW."isArchived" OR NOT NEW."isSystem"
  ) THEN
    RAISE EXCEPTION 'System account % can be renamed but not recoded, retyped or archived', OLD."code";
  END IF;

  -- Retyping an account with postings would silently move history between
  -- the P&L and the balance sheet.
  IF NEW."type" <> OLD."type" AND EXISTS (SELECT 1 FROM "journal_lines" WHERE "accountId" = OLD."id") THEN
    RAISE EXCEPTION 'Account % has postings and cannot change type', OLD."code";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_accounts_guard"
  BEFORE UPDATE OR DELETE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION "ledger_accounts_guard"();

-- Seed: the singleton settings row and the default UK chart of accounts
-- (generated from DEFAULT_CHART in src/lib/accounting/chart.ts; a unit test
-- checks the two still match).
-- Placeholder company details; set the real ones in Books settings. The books
-- year defaults to the UK tax year (6 April is approximated by 1 April here)
-- and follows the company's own year end once configured.
INSERT INTO "company_settings" ("id", "legalName", "companyNumber", "yearStartMonth", "yearStartDay", "updatedAt")
VALUES ('default', 'My Company', NULL, 4, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ledger_accounts" ("id", "code", "name", "type", "isSystem", "updatedAt")
SELECT gen_random_uuid()::text, v.code, v.name, v.type::"LedgerAccountType", v.is_system, CURRENT_TIMESTAMP
FROM (VALUES
  ('1000', 'Office equipment', 'ASSET', false),
  ('1010', 'Office equipment depreciation', 'ASSET', false),
  ('1100', 'Trade debtors', 'ASSET', true),
  ('1150', 'Prepayments', 'ASSET', false),
  ('1200', 'Business bank account', 'ASSET', true),
  ('1210', 'Savings account', 'ASSET', false),
  ('1300', 'Other debtors', 'ASSET', false),
  ('2100', 'Trade creditors', 'LIABILITY', true),
  ('2110', 'Other creditors', 'LIABILITY', false),
  ('2150', 'Accruals', 'LIABILITY', false),
  ('2200', 'VAT', 'LIABILITY', true),
  ('2210', 'PAYE and NIC', 'LIABILITY', false),
  ('2220', 'Corporation tax', 'LIABILITY', false),
  ('2300', 'Loans', 'LIABILITY', true),
  ('2400', 'Director''s loan account', 'LIABILITY', true),
  ('2500', 'Deferred grant income', 'LIABILITY', true),
  ('2999', 'Suspense', 'LIABILITY', true),
  ('3000', 'Share capital', 'EQUITY', true),
  ('3100', 'Retained earnings', 'EQUITY', true),
  ('3900', 'Opening balance adjustments', 'EQUITY', true),
  ('4000', 'Sales', 'INCOME', true),
  ('4100', 'Other income', 'INCOME', false),
  ('4900', 'Grant income', 'INCOME', true),
  ('5000', 'Cost of sales', 'EXPENSE', false),
  ('5100', 'Subcontractors', 'EXPENSE', false),
  ('6000', 'Salaries', 'EXPENSE', false),
  ('6010', 'Employer''s NIC', 'EXPENSE', false),
  ('6020', 'Pension contributions', 'EXPENSE', false),
  ('6100', 'Rent and rates', 'EXPENSE', false),
  ('6200', 'Utilities', 'EXPENSE', false),
  ('6300', 'Travel', 'EXPENSE', false),
  ('6400', 'Software and subscriptions', 'EXPENSE', false),
  ('6500', 'Professional fees', 'EXPENSE', false),
  ('6510', 'Accountancy fees', 'EXPENSE', false),
  ('6600', 'Marketing', 'EXPENSE', false),
  ('6700', 'Bank charges', 'EXPENSE', false),
  ('6800', 'Insurance', 'EXPENSE', false),
  ('6900', 'Telephone and internet', 'EXPENSE', false),
  ('7000', 'Research and development', 'EXPENSE', false),
  ('7100', 'Equipment (expensed)', 'EXPENSE', false),
  ('7200', 'Training', 'EXPENSE', false),
  ('7500', 'Depreciation', 'EXPENSE', false),
  ('7900', 'General expenses', 'EXPENSE', false),
  ('8000', 'Interest paid', 'EXPENSE', false)
) AS v(code, name, type, is_system)
ON CONFLICT ("code") DO NOTHING;
