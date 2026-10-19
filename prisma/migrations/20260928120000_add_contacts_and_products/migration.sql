-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "type" "ContactType" NOT NULL DEFAULT 'CUSTOMER',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "taxId" TEXT,
    "billingAddress" TEXT,
    "shippingAddress" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'item',
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "incomeAccountId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_type_idx" ON "contacts"("type");

-- CreateIndex
CREATE INDEX "contacts_name_idx" ON "contacts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Contact and product rules ───────────────────────────────────────────────
-- As with the ledger, the rules in src/lib/accounting/sales.ts are repeated
-- here so an import script or a psql session cannot bypass them.

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_name_check" CHECK (length(btrim("name")) > 0),
  -- 0 = due on receipt. The upper bound is a typo guard, not a business rule.
  ADD CONSTRAINT "contacts_terms_check" CHECK ("paymentTermsDays" BETWEEN 0 AND 365);

-- One record per organisation, regardless of case or stray spaces: the point
-- of failure at import time is the same customer arriving twice.
CREATE UNIQUE INDEX "contacts_name_unique" ON "contacts" (lower(btrim("name")));

ALTER TABLE "products"
  ADD CONSTRAINT "products_name_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "products_unit_check" CHECK (length(btrim("unit")) > 0),
  -- Codes are printed on invoices and matched on import: uppercase, no spaces.
  ADD CONSTRAINT "products_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._/-]*$'),
  ADD CONSTRAINT "products_price_check" CHECK ("unitPrice" >= 0);

-- A product's income account must actually be an income account, and a live
-- one: approving an invoice built on it posts the sale there.
CREATE FUNCTION "products_income_account_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account "ledger_accounts"%ROWTYPE;
BEGIN
  IF NEW."incomeAccountId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO account FROM "ledger_accounts" WHERE "id" = NEW."incomeAccountId";
  IF account."type" <> 'INCOME' THEN
    RAISE EXCEPTION 'Account % is a % account; a product''s income account must be INCOME',
      account."code", account."type";
  END IF;
  IF account."isArchived" THEN
    RAISE EXCEPTION 'Account % is archived and cannot take new sales', account."code";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_income_account_guard"
  BEFORE INSERT OR UPDATE OF "incomeAccountId" ON "products"
  FOR EACH ROW EXECUTE FUNCTION "products_income_account_guard"();
