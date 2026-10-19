-- CreateEnum
CREATE TYPE "StatementImportStatus" AS ENUM ('IMPORTED', 'UNDONE');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "sortCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "importProfile" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_imports" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "status" "StatementImportStatus" NOT NULL DEFAULT 'IMPORTED',
    "lineCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "firstDate" DATE,
    "lastDate" DATE,
    "openingBalance" DECIMAL(14,2),
    "closingBalance" DECIMAL(14,2),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_lines" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2),
    "sequence" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_ledgerAccountId_key" ON "bank_accounts"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_sortCode_accountNumber_key" ON "bank_accounts"("sortCode", "accountNumber");

-- CreateIndex
CREATE INDEX "statement_imports_bankAccountId_createdAt_idx" ON "statement_imports"("bankAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "statement_lines_bankAccountId_date_sequence_idx" ON "statement_lines"("bankAccountId", "date", "sequence");

-- CreateIndex
CREATE INDEX "statement_lines_importId_idx" ON "statement_lines"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "statement_lines_bankAccountId_fingerprint_key" ON "statement_lines"("bankAccountId", "fingerprint");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_undoneById_fkey" FOREIGN KEY ("undoneById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─── Bank statement rules ────────────────────────────────────────────────────
-- What src/lib/accounting/statements.ts relies on, repeated where no code path
-- can get around it. Statement lines are the bank's record, not ours: they are
-- written once, never edited, and only removed by undoing an unreconciled
-- import.

ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_name_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "bank_accounts_sort_code_check" CHECK ("sortCode" ~ '^[0-9]{6}$'),
  ADD CONSTRAINT "bank_accounts_account_number_check" CHECK ("accountNumber" ~ '^[0-9]{8}$');

ALTER TABLE "statement_lines"
  ADD CONSTRAINT "statement_lines_amount_check" CHECK ("amount" <> 0),
  ADD CONSTRAINT "statement_lines_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "statement_imports"
  ADD CONSTRAINT "statement_imports_undone_check"
    CHECK (("status" = 'UNDONE') = ("undoneAt" IS NOT NULL));

-- A bank account books to a live 12xx asset account, the same rule payments use.
CREATE FUNCTION "bank_accounts_ledger_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account "ledger_accounts"%ROWTYPE;
BEGIN
  SELECT * INTO account FROM "ledger_accounts" WHERE "id" = NEW."ledgerAccountId";
  IF account."type" <> 'ASSET' OR account."code" NOT BETWEEN '1200' AND '1299' THEN
    RAISE EXCEPTION 'Account % is not a bank account (12xx)', account."code";
  END IF;
  IF account."isArchived" THEN
    RAISE EXCEPTION 'Account % is archived', account."code";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bank_accounts_ledger_guard"
  BEFORE INSERT OR UPDATE OF "ledgerAccountId" ON "bank_accounts"
  FOR EACH ROW EXECUTE FUNCTION "bank_accounts_ledger_guard"();

-- Lines once imported say what the bank said. Only reconciliation may mark
-- one, and only an unreconciled line may go (with its import, by undo).
CREATE FUNCTION "statement_lines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unchanged "statement_lines"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."reconciledAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A reconciled statement line cannot be removed';
    END IF;
    RETURN OLD;
  END IF;

  unchanged := NEW;
  unchanged."reconciledAt" := OLD."reconciledAt";
  IF unchanged IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Statement lines are what the bank said: they are not edited';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "statement_lines_guard"
  BEFORE UPDATE OR DELETE ON "statement_lines"
  FOR EACH ROW EXECUTE FUNCTION "statement_lines_guard"();

-- An import is a record of what was brought in. It can be marked undone,
-- never edited otherwise and never deleted.
CREATE FUNCTION "statement_imports_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unchanged "statement_imports"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Statement imports are kept; undo one instead';
  END IF;
  IF OLD."status" = 'UNDONE' THEN
    RAISE EXCEPTION 'This import has already been undone';
  END IF;

  unchanged := NEW;
  unchanged."status" := OLD."status";
  unchanged."undoneAt" := OLD."undoneAt";
  unchanged."undoneById" := OLD."undoneById";
  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL) THEN
    RAISE EXCEPTION 'A statement import is not edited; undo it and import again';
  END IF;
  IF NEW."status" = 'UNDONE'
     AND EXISTS (SELECT 1 FROM "statement_lines" WHERE "importId" = NEW."id") THEN
    RAISE EXCEPTION 'Remove the import''s lines before marking it undone';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "statement_imports_guard"
  BEFORE UPDATE OR DELETE ON "statement_imports"
  FOR EACH ROW EXECUTE FUNCTION "statement_imports_guard"();
