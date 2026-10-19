-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'APPROVED', 'VOID');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "creditNotePrefix" TEXT NOT NULL DEFAULT 'CN',
ADD COLUMN     "nextCreditNoteNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "contactId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "issueDate" DATE NOT NULL,
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
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
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

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_allocations" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_number_key" ON "credit_notes"("number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_journalEntryId_key" ON "credit_notes"("journalEntryId");

-- CreateIndex
CREATE INDEX "credit_notes_status_issueDate_idx" ON "credit_notes"("status", "issueDate");

-- CreateIndex
CREATE INDEX "credit_notes_contactId_idx" ON "credit_notes"("contactId");

-- CreateIndex
CREATE INDEX "credit_notes_invoiceId_idx" ON "credit_notes"("invoiceId");

-- CreateIndex
CREATE INDEX "credit_note_lines_productId_idx" ON "credit_note_lines"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_lines_creditNoteId_lineNumber_key" ON "credit_note_lines"("creditNoteId", "lineNumber");

-- CreateIndex
CREATE INDEX "credit_allocations_creditNoteId_idx" ON "credit_allocations"("creditNoteId");

-- CreateIndex
CREATE INDEX "credit_allocations_invoiceId_idx" ON "credit_allocations"("invoiceId");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─── Credit note rules ───────────────────────────────────────────────────────
-- The rules src/lib/accounting/credit-notes.ts applies, repeated where no code
-- path — Hermes, a script, a psql session — can get around them. They follow
-- the invoice rules in 20260930120000_add_sales_invoices.

ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_next_credit_note_check" CHECK ("nextCreditNoteNumber" >= 1),
  ADD CONSTRAINT "company_settings_credit_note_prefix_check"
    CHECK ("creditNotePrefix" ~ '^[A-Z0-9-]{0,10}$');

ALTER TABLE "credit_notes"
  -- A draft has no number; anything further along has one.
  ADD CONSTRAINT "credit_notes_number_check"
    CHECK (("status" = 'DRAFT') = ("number" IS NULL)),
  ADD CONSTRAINT "credit_notes_name_check" CHECK (length(btrim("billToName")) > 0),
  ADD CONSTRAINT "credit_notes_total_check" CHECK ("total" = "subtotal"),
  -- Approval posts the journal, so an approved credit note has one.
  ADD CONSTRAINT "credit_notes_journal_check"
    CHECK ("status" <> 'APPROVED' OR "journalEntryId" IS NOT NULL);

ALTER TABLE "credit_note_lines"
  ADD CONSTRAINT "credit_note_lines_name_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "credit_note_lines_unit_check" CHECK (length(btrim("unit")) > 0),
  ADD CONSTRAINT "credit_note_lines_price_check" CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "credit_note_lines_amount_check"
    CHECK ("amount" = round("quantity" * "unitPrice", 2));

ALTER TABLE "credit_allocations"
  ADD CONSTRAINT "credit_allocations_amount_check" CHECK ("amount" > 0);

-- A credit note line debits a live income account: the same rule, and the
-- same function, as an invoice line.
CREATE TRIGGER "credit_note_lines_income_account_guard"
  BEFORE INSERT OR UPDATE OF "incomeAccountId" ON "credit_note_lines"
  FOR EACH ROW EXECUTE FUNCTION "invoice_lines_income_account_guard"();

-- A credit note is raised as a draft, and once approved it is a document:
-- only its status (to VOID, and nowhere after that) and notes may move.
CREATE FUNCTION "credit_notes_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unchanged "credit_notes"%ROWTYPE;
  invoice_contact text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Credit notes are created as drafts and then approved';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."invoiceId" IS NOT NULL THEN
    SELECT "contactId" INTO invoice_contact FROM "invoices" WHERE "id" = NEW."invoiceId";
    IF invoice_contact IS DISTINCT FROM NEW."contactId" THEN
      RAISE EXCEPTION 'A credit note must be for the same customer as the invoice it corrects';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR OLD."status" = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Credit note % is approved and cannot be deleted; void it instead', OLD."number";
  END IF;

  IF OLD."status" = 'VOID' AND NEW."status" <> 'VOID' THEN
    RAISE EXCEPTION 'Credit note % is void, and a void is final', OLD."number";
  END IF;
  IF NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'Credit note % is approved and cannot go back to draft', OLD."number";
  END IF;

  unchanged := NEW;
  unchanged."status" := OLD."status";
  unchanged."notes" := OLD."notes";
  unchanged."updatedAt" := OLD."updatedAt";
  unchanged."createdById" := OLD."createdById";
  unchanged."approvedById" := OLD."approvedById";

  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL)
     OR (NEW."approvedById" IS DISTINCT FROM OLD."approvedById" AND NEW."approvedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'Credit note % is approved: it cannot be edited, only voided', OLD."number";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "credit_notes_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "credit_notes"
  FOR EACH ROW EXECUTE FUNCTION "credit_notes_guard"();

CREATE FUNCTION "credit_note_lines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  note_status "CreditNoteStatus";
  note_number text;
BEGIN
  SELECT "status", "number" INTO note_status, note_number
    FROM "credit_notes" WHERE "id" = COALESCE(NEW."creditNoteId", OLD."creditNoteId");

  -- No row means the draft is being deleted and its lines are cascading.
  IF note_status IS NULL OR note_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'Credit note % is approved: its lines cannot be changed', note_number;
END;
$$;

CREATE TRIGGER "credit_note_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "credit_note_lines"
  FOR EACH ROW EXECUTE FUNCTION "credit_note_lines_guard"();

-- An allocation applies an approved credit note to a live invoice of the same
-- customer, and neither side can be allocated past its total. Both rows are
-- locked (invoice first, the order the service uses) so two allocations racing
-- for the same invoice queue instead of both passing the sum check.
-- Allocations are never edited, and disappear only with a voided credit note.
CREATE FUNCTION "credit_allocations_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv "invoices"%ROWTYPE;
  note "credit_notes"%ROWTYPE;
  on_invoice numeric;
  from_note numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Credit allocations are not edited; void the credit note and raise another';
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT * INTO note FROM "credit_notes" WHERE "id" = OLD."creditNoteId";
    IF note."status" <> 'VOID' THEN
      RAISE EXCEPTION 'Credit note % is still live: void it to release its allocations', note."number";
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO inv FROM "invoices" WHERE "id" = NEW."invoiceId" FOR UPDATE;
  SELECT * INTO note FROM "credit_notes" WHERE "id" = NEW."creditNoteId" FOR UPDATE;

  IF note."status" <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only an approved credit note can be allocated';
  END IF;
  IF inv."status" IN ('DRAFT', 'VOID') THEN
    RAISE EXCEPTION 'A credit can only be allocated to an approved, unvoided invoice';
  END IF;
  IF inv."contactId" <> note."contactId" THEN
    RAISE EXCEPTION 'Credit note % and invoice % are for different customers', note."number", inv."number";
  END IF;

  SELECT COALESCE(sum("amount"), 0) INTO on_invoice
    FROM "credit_allocations" WHERE "invoiceId" = NEW."invoiceId";
  IF on_invoice + NEW."amount" > inv."total" THEN
    RAISE EXCEPTION 'Invoice % would be credited beyond its total', inv."number";
  END IF;

  SELECT COALESCE(sum("amount"), 0) INTO from_note
    FROM "credit_allocations" WHERE "creditNoteId" = NEW."creditNoteId";
  IF from_note + NEW."amount" > note."total" THEN
    RAISE EXCEPTION 'Credit note % would be allocated beyond its total', note."number";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "credit_allocations_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "credit_allocations"
  FOR EACH ROW EXECUTE FUNCTION "credit_allocations_guard"();

-- Voiding a credited invoice would reverse the sale while the credit note
-- still reverses part of it: the customer would be credited twice.
CREATE FUNCTION "invoices_credit_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "credit_allocations" WHERE "invoiceId" = NEW."id") THEN
    RAISE EXCEPTION 'Invoice % has credit allocated to it: void the credit note first', NEW."number";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_credit_guard"
  BEFORE UPDATE OF "status" ON "invoices"
  FOR EACH ROW WHEN (NEW."status" = 'VOID' AND OLD."status" <> 'VOID')
  EXECUTE FUNCTION "invoices_credit_guard"();
