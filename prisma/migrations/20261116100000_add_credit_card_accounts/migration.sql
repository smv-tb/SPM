-- Company credit cards. A card is held in "bank_accounts" beside the bank
-- accounts, so statement import and reconciliation are the same code and the
-- same guards; what differs is what it books to (a 20xx liability, not a 12xx
-- asset) and how it is identified (the last four digits only — the full card
-- number is never stored).

CREATE TYPE "BankAccountKind" AS ENUM ('BANK', 'CREDIT_CARD');

ALTER TABLE "bank_accounts"
  ADD COLUMN "kind" "BankAccountKind" NOT NULL DEFAULT 'BANK',
  ADD COLUMN "cardLastFour" TEXT,
  ALTER COLUMN "sortCode" DROP NOT NULL,
  ALTER COLUMN "accountNumber" DROP NOT NULL;

-- A bank account has a sort code and number and no card digits; a card the
-- reverse. The format checks on each column stay as they were.
ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_kind_details_check" CHECK (
    ("kind" = 'BANK'
      AND "sortCode" IS NOT NULL AND "accountNumber" IS NOT NULL AND "cardLastFour" IS NULL)
    OR
    ("kind" = 'CREDIT_CARD'
      AND "sortCode" IS NULL AND "accountNumber" IS NULL AND "accountNumberIdx" IS NULL
      AND "cardLastFour" IS NOT NULL AND "cardLastFour" ~ '^[0-9]{4}$')
  );

-- A bank account books to a live 12xx asset account; a credit card to a live
-- 20xx liability account. What an account is cannot change afterwards: its
-- statement lines and reconciliations were made against that ledger account.
CREATE OR REPLACE FUNCTION "bank_accounts_ledger_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account "ledger_accounts"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'A bank account cannot become a credit card, or a card a bank account';
  END IF;
  SELECT * INTO account FROM "ledger_accounts" WHERE "id" = NEW."ledgerAccountId";
  IF NEW."kind" = 'BANK' THEN
    IF account."type" <> 'ASSET' OR account."code" NOT BETWEEN '1200' AND '1299' THEN
      RAISE EXCEPTION 'Account % is not a bank account (12xx)', account."code";
    END IF;
  ELSE
    IF account."type" <> 'LIABILITY' OR account."code" NOT BETWEEN '2000' AND '2099' THEN
      RAISE EXCEPTION 'Account % is not a credit card account (20xx)', account."code";
    END IF;
  END IF;
  IF account."isArchived" THEN
    RAISE EXCEPTION 'Account % is archived', account."code";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "bank_accounts_ledger_guard" ON "bank_accounts";
CREATE TRIGGER "bank_accounts_ledger_guard"
  BEFORE INSERT OR UPDATE OF "ledgerAccountId", "kind" ON "bank_accounts"
  FOR EACH ROW EXECUTE FUNCTION "bank_accounts_ledger_guard"();

-- A supplier can be paid by card: the payment credits the card's 20xx account
-- instead of a 12xx bank account. Otherwise the guard is as it was. Customer
-- payments are unchanged: customers' money arrives in a bank account.
CREATE OR REPLACE FUNCTION "supplier_payments_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account "ledger_accounts"%ROWTYPE;
  journal_status "JournalStatus";
  payee_type "ContactType";
  unchanged "supplier_payments"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supplier payments are never deleted; void it instead';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'POSTED' THEN
      RAISE EXCEPTION 'A supplier payment is recorded as posted';
    END IF;
    SELECT "status" INTO journal_status FROM "journal_entries" WHERE "id" = NEW."journalEntryId";
    IF journal_status IS DISTINCT FROM 'POSTED' THEN
      RAISE EXCEPTION 'A supplier payment needs its posted journal';
    END IF;
    SELECT * INTO account FROM "ledger_accounts" WHERE "id" = NEW."bankAccountId";
    IF account."isArchived" OR NOT (
         (account."type" = 'ASSET' AND account."code" BETWEEN '1200' AND '1299')
      OR (account."type" = 'LIABILITY' AND account."code" BETWEEN '2000' AND '2099')
    ) THEN
      RAISE EXCEPTION 'Account % is not a live bank (12xx) or credit card (20xx) account', account."code";
    END IF;
    SELECT "type" INTO payee_type FROM "contacts" WHERE "id" = NEW."contactId";
    IF payee_type = 'CUSTOMER' THEN
      RAISE EXCEPTION 'A supplier payment must be to a supplier (or a contact who is both)';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'VOID' THEN
    RAISE EXCEPTION 'This supplier payment is void, and a void is final';
  END IF;

  unchanged := NEW;
  unchanged."status" := OLD."status";
  unchanged."voidedAt" := OLD."voidedAt";
  unchanged."notes" := OLD."notes";
  unchanged."updatedAt" := OLD."updatedAt";
  unchanged."createdById" := OLD."createdById";
  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL) THEN
    RAISE EXCEPTION 'A recorded supplier payment cannot be edited, only voided';
  END IF;

  RETURN NEW;
END;
$$;

-- Somewhere for the first card to book to. Left alone if 2050 is already used.
INSERT INTO "ledger_accounts" ("id", "code", "name", "type", "isSystem", "updatedAt")
VALUES (gen_random_uuid()::text, '2050', 'Company credit card', 'LIABILITY', false, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
