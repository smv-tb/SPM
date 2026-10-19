-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'PART_PAID', 'PAID', 'VOID');

-- AlterTable: invoice numbering and the details an invoice must print
ALTER TABLE "company_settings"
  ADD COLUMN "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
  ADD COLUMN "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "invoiceNumberPad" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "registeredAddress" TEXT,
  ADD COLUMN "placeOfRegistration" TEXT,
  ADD COLUMN "bankAccountName" TEXT,
  ADD COLUMN "bankSortCode" TEXT,
  ADD COLUMN "bankAccountNumber" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "contactId" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3),
    "reference" TEXT,
    "notes" TEXT,
    "billToName" TEXT NOT NULL,
    "billToAddress" TEXT,
    "shipToAddress" TEXT,
    "taxId" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "journalEntryId" TEXT,
    "isImported" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "productId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'item',
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatCode" TEXT,
    "incomeAccountId" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_journalEntryId_key" ON "invoices"("journalEntryId");

-- CreateIndex
CREATE INDEX "invoices_status_issueDate_idx" ON "invoices"("status", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_contactId_idx" ON "invoices"("contactId");

-- CreateIndex
CREATE INDEX "invoices_dueDate_idx" ON "invoices"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoiceId_lineNumber_key" ON "invoice_lines"("invoiceId", "lineNumber");

-- CreateIndex
CREATE INDEX "invoice_lines_productId_idx" ON "invoice_lines"("productId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Invoice rules ───────────────────────────────────────────────────────────
-- The same rules src/lib/accounting/invoices.ts applies, repeated where no
-- code path — Hermes, a script, a psql session — can get around them.

ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_next_invoice_check" CHECK ("nextInvoiceNumber" >= 1),
  ADD CONSTRAINT "company_settings_invoice_pad_check" CHECK ("invoiceNumberPad" BETWEEN 1 AND 10),
  ADD CONSTRAINT "company_settings_invoice_prefix_check"
    CHECK ("invoicePrefix" ~ '^[A-Z0-9-]{0,10}$');

ALTER TABLE "invoices"
  -- A draft has no number; anything further along has one.
  ADD CONSTRAINT "invoices_number_check"
    CHECK (("status" = 'DRAFT') = ("number" IS NULL)),
  ADD CONSTRAINT "invoices_terms_check" CHECK ("paymentTermsDays" BETWEEN 0 AND 365),
  ADD CONSTRAINT "invoices_due_after_issue_check" CHECK ("dueDate" >= "issueDate"),
  ADD CONSTRAINT "invoices_name_check" CHECK (length(btrim("billToName")) > 0),
  ADD CONSTRAINT "invoices_total_check" CHECK ("total" = "subtotal"),
  -- Approval posts the journal, so a live invoice has one. An import is the
  -- exception: it is history, recorded but never posted again.
  ADD CONSTRAINT "invoices_journal_check"
    CHECK ("status" IN ('DRAFT', 'VOID') OR "isImported" OR "journalEntryId" IS NOT NULL);

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_name_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "invoice_lines_unit_check" CHECK (length(btrim("unit")) > 0),
  ADD CONSTRAINT "invoice_lines_price_check" CHECK ("unitPrice" >= 0),
  -- The one piece of arithmetic on the document: numeric round() is half away
  -- from zero, the same rule `lineAmountPence` applies in TypeScript.
  ADD CONSTRAINT "invoice_lines_amount_check"
    CHECK ("amount" = round("quantity" * "unitPrice", 2));

-- An invoice line's income account must be a live income account, exactly as
-- for a product (products_income_account_guard).
CREATE FUNCTION "invoice_lines_income_account_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account "ledger_accounts"%ROWTYPE;
BEGIN
  IF NEW."incomeAccountId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO account FROM "ledger_accounts" WHERE "id" = NEW."incomeAccountId";
  IF account."type" <> 'INCOME' THEN
    RAISE EXCEPTION 'Account % is a % account; an invoice line must credit an INCOME account',
      account."code", account."type";
  END IF;
  IF account."isArchived" THEN
    RAISE EXCEPTION 'Account % is archived and cannot take new sales', account."code";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoice_lines_income_account_guard"
  BEFORE INSERT OR UPDATE OF "incomeAccountId" ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "invoice_lines_income_account_guard"();

-- Once an invoice is approved it is a document that has left the building:
-- its figures, dates and customer are fixed. Being sent, part paid, paid or
-- voided still has to be recordable, so only that narrow set of columns may
-- move afterwards.
CREATE FUNCTION "invoices_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unchanged "invoices"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' AND NOT NEW."isImported" THEN
      RAISE EXCEPTION 'Invoices are created as drafts and then approved';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoice % is approved and cannot be deleted; void it or raise a credit note', OLD."number";
  END IF;

  -- Everything except the columns that legitimately move after approval must
  -- match. (A deleted user's id being nulled by ON DELETE SET NULL is allowed:
  -- who approved it survives in the audit log.)
  unchanged := NEW;
  unchanged."status" := OLD."status";
  unchanged."sentAt" := OLD."sentAt";
  unchanged."notes" := OLD."notes";
  unchanged."updatedAt" := OLD."updatedAt";
  unchanged."createdById" := OLD."createdById";
  unchanged."approvedById" := OLD."approvedById";

  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL)
     OR (NEW."approvedById" IS DISTINCT FROM OLD."approvedById" AND NEW."approvedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'Invoice % is approved: correct it with a credit note, not an edit', OLD."number";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_guard"();

-- The lines of an approved invoice are part of that fixed document.
CREATE FUNCTION "invoice_lines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
  invoice_number text;
  invoice_id text;
  imported boolean;
BEGIN
  invoice_id := COALESCE(NEW."invoiceId", OLD."invoiceId");
  SELECT "status", "number", "isImported" INTO invoice_status, invoice_number, imported
    FROM "invoices" WHERE "id" = invoice_id;

  -- No row means the invoice is being deleted and its lines are cascading.
  IF invoice_status IS NULL OR invoice_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- History being loaded: an imported invoice arrives already approved or
  -- paid, so its lines have to be insertable. Changing them afterwards is
  -- still refused.
  IF imported AND TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invoice % is approved: its lines cannot be changed', invoice_number;
END;
$$;

CREATE TRIGGER "invoice_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "invoice_lines_guard"();
