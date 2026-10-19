-- CreateEnum
CREATE TYPE "CustomerPaymentKind" AS ENUM ('RECEIPT', 'REFUND');

-- CreateEnum
CREATE TYPE "CustomerPaymentStatus" AS ENUM ('POSTED', 'VOID');

-- AlterTable
ALTER TABLE "credit_allocations" ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "releasedOn" DATE,
ALTER COLUMN "invoiceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" TEXT NOT NULL,
    "kind" "CustomerPaymentKind" NOT NULL,
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'POSTED',
    "contactId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "createdById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "refundId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "releasedOn" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_journalEntryId_key" ON "customer_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "customer_payments_contactId_date_idx" ON "customer_payments"("contactId", "date");

-- CreateIndex
CREATE INDEX "customer_payments_kind_status_date_idx" ON "customer_payments"("kind", "status", "date");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_allocations_refundId_idx" ON "payment_allocations"("refundId");

-- CreateIndex
CREATE INDEX "credit_allocations_refundId_idx" ON "credit_allocations"("refundId");

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Customer payment rules ──────────────────────────────────────────────────
-- The rules src/lib/accounting/payments.ts applies, repeated where no code
-- path can get around them. Credits and payments now settle invoices
-- together, so the invoice-side limit is their sum — the credit allocation
-- guard below is replaced to count both.
--
-- Allocations are history: a void no longer deletes them but releases them
-- (releasedOn), so a report as at an earlier date still sees what was settled
-- then. Every sum below counts only unreleased rows.

ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "customer_payments_void_check" CHECK (("status" = 'VOID') = ("voidedAt" IS NOT NULL));

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "payment_allocations_target_check"
    CHECK (("invoiceId" IS NULL) <> ("refundId" IS NULL));

ALTER TABLE "credit_allocations"
  ADD CONSTRAINT "credit_allocations_target_check"
    CHECK (("invoiceId" IS NULL) <> ("refundId" IS NULL)),
  ADD CONSTRAINT "credit_allocations_released_check"
    CHECK ("releasedOn" IS NULL OR "releasedOn" >= "date");

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_released_check"
    CHECK ("releasedOn" IS NULL OR "releasedOn" >= "date");

-- What has been applied to an invoice, from credit notes and receipts.
CREATE FUNCTION "invoice_settled"(invoice_id text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT sum("amount") FROM "credit_allocations"
                     WHERE "invoiceId" = invoice_id AND "releasedOn" IS NULL), 0)
       + COALESCE((SELECT sum("amount") FROM "payment_allocations"
                     WHERE "invoiceId" = invoice_id AND "releasedOn" IS NULL), 0)
$$;

-- How much of a refund has been sourced, from credit notes and receipts.
CREATE FUNCTION "refund_sourced"(refund_id text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT sum("amount") FROM "credit_allocations"
                     WHERE "refundId" = refund_id AND "releasedOn" IS NULL), 0)
       + COALESCE((SELECT sum("amount") FROM "payment_allocations"
                     WHERE "refundId" = refund_id AND "releasedOn" IS NULL), 0)
$$;

-- A payment is posted when it is recorded — it records something the bank
-- has already done — and is fixed afterwards: it can only be voided.
CREATE FUNCTION "customer_payments_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account "ledger_accounts"%ROWTYPE;
  journal_status "JournalStatus";
  unchanged "customer_payments"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments are never deleted; void it instead';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'POSTED' THEN
      RAISE EXCEPTION 'A payment is recorded as posted';
    END IF;
    SELECT "status" INTO journal_status FROM "journal_entries" WHERE "id" = NEW."journalEntryId";
    IF journal_status IS DISTINCT FROM 'POSTED' THEN
      RAISE EXCEPTION 'A payment needs its posted journal';
    END IF;
    SELECT * INTO account FROM "ledger_accounts" WHERE "id" = NEW."bankAccountId";
    IF account."type" <> 'ASSET' OR account."code" NOT BETWEEN '1200' AND '1299' OR account."isArchived" THEN
      RAISE EXCEPTION 'Account % is not a live bank account (12xx)', account."code";
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'VOID' THEN
    RAISE EXCEPTION 'This payment is void, and a void is final';
  END IF;

  unchanged := NEW;
  unchanged."status" := OLD."status";
  unchanged."voidedAt" := OLD."voidedAt";
  unchanged."notes" := OLD."notes";
  unchanged."updatedAt" := OLD."updatedAt";
  unchanged."createdById" := OLD."createdById";
  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL) THEN
    RAISE EXCEPTION 'A recorded payment cannot be edited, only voided';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "customer_payments_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "customer_payments"
  FOR EACH ROW EXECUTE FUNCTION "customer_payments_guard"();

-- Checks the target side of an allocation (an invoice or a refund) for either
-- allocation table. Locks the target first — the order the services use — so
-- allocations racing for one invoice or refund queue.
CREATE FUNCTION "check_allocation_target"(
  invoice_id text, refund_id text, contact_id text, amount numeric
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  inv "invoices"%ROWTYPE;
  refund "customer_payments"%ROWTYPE;
BEGIN
  IF invoice_id IS NOT NULL THEN
    SELECT * INTO inv FROM "invoices" WHERE "id" = invoice_id FOR UPDATE;
    IF inv."status" IN ('DRAFT', 'VOID') THEN
      RAISE EXCEPTION 'Only an approved, unvoided invoice can be settled';
    END IF;
    IF inv."contactId" <> contact_id THEN
      RAISE EXCEPTION 'Invoice % is for a different customer', inv."number";
    END IF;
    IF "invoice_settled"(invoice_id) + amount > inv."total" THEN
      RAISE EXCEPTION 'Invoice % would be settled beyond its total', inv."number";
    END IF;
  ELSE
    SELECT * INTO refund FROM "customer_payments" WHERE "id" = refund_id FOR UPDATE;
    IF refund."kind" <> 'REFUND' OR refund."status" <> 'POSTED' THEN
      RAISE EXCEPTION 'Credit can only be paid out by a posted refund';
    END IF;
    IF refund."contactId" <> contact_id THEN
      RAISE EXCEPTION 'A refund must be for the customer whose credit it pays';
    END IF;
    IF "refund_sourced"(refund_id) + amount > refund."amount" THEN
      RAISE EXCEPTION 'A refund cannot pay out more than its amount';
    END IF;
  END IF;
END;
$$;

-- The one change an allocation may undergo: being released, once and for
-- good, when its document is voided. A refund's source is released by voiding
-- the refund; anything else by voiding the source document.
CREATE FUNCTION "check_allocation_release"(
  old_row jsonb, new_row jsonb, source_void boolean
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  refund_status "CustomerPaymentStatus";
BEGIN
  IF old_row->>'releasedOn' IS NOT NULL OR new_row->>'releasedOn' IS NULL
     OR (old_row - 'releasedOn') IS DISTINCT FROM (new_row - 'releasedOn') THEN
    RAISE EXCEPTION 'Allocations are not edited; void the document to release them';
  END IF;
  IF new_row->>'refundId' IS NOT NULL THEN
    SELECT "status" INTO refund_status FROM "customer_payments" WHERE "id" = new_row->>'refundId';
    IF refund_status <> 'VOID' THEN
      RAISE EXCEPTION 'This has been refunded to the customer: void the refund first';
    END IF;
  ELSIF NOT source_void THEN
    RAISE EXCEPTION 'The document is still live: void it to release its allocations';
  END IF;
END;
$$;

-- Replaces the 4.4 guard: same source-side rules, the target is now an
-- invoice (counted with payments) or a refund, and allocations are released
-- rather than deleted.
CREATE OR REPLACE FUNCTION "credit_allocations_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  note "credit_notes"%ROWTYPE;
  from_note numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Credit allocations are never deleted; void the credit note to release them';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM "check_allocation_release"(
      to_jsonb(OLD), to_jsonb(NEW),
      (SELECT "status" = 'VOID' FROM "credit_notes" WHERE "id" = NEW."creditNoteId"));
    RETURN NEW;
  END IF;

  IF NEW."releasedOn" IS NOT NULL THEN
    RAISE EXCEPTION 'An allocation is made live; it is released only by a void';
  END IF;

  SELECT "contactId" INTO note."contactId" FROM "credit_notes" WHERE "id" = NEW."creditNoteId";
  PERFORM "check_allocation_target"(NEW."invoiceId", NEW."refundId", note."contactId", NEW."amount");

  SELECT * INTO note FROM "credit_notes" WHERE "id" = NEW."creditNoteId" FOR UPDATE;
  IF note."status" <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only an approved credit note can be allocated';
  END IF;
  SELECT COALESCE(sum("amount"), 0) INTO from_note
    FROM "credit_allocations" WHERE "creditNoteId" = NEW."creditNoteId" AND "releasedOn" IS NULL;
  IF from_note + NEW."amount" > note."total" THEN
    RAISE EXCEPTION 'Credit note % would be allocated beyond its total', note."number";
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "payment_allocations_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  receipt "customer_payments"%ROWTYPE;
  from_receipt numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment allocations are never deleted; void the payment to release them';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM "check_allocation_release"(
      to_jsonb(OLD), to_jsonb(NEW),
      (SELECT "status" = 'VOID' FROM "customer_payments" WHERE "id" = NEW."paymentId"));
    RETURN NEW;
  END IF;

  IF NEW."releasedOn" IS NOT NULL THEN
    RAISE EXCEPTION 'An allocation is made live; it is released only by a void';
  END IF;

  SELECT "contactId" INTO receipt."contactId" FROM "customer_payments" WHERE "id" = NEW."paymentId";
  PERFORM "check_allocation_target"(NEW."invoiceId", NEW."refundId", receipt."contactId", NEW."amount");

  SELECT * INTO receipt FROM "customer_payments" WHERE "id" = NEW."paymentId" FOR UPDATE;
  IF receipt."kind" <> 'RECEIPT' OR receipt."status" <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted receipt can be allocated';
  END IF;
  SELECT COALESCE(sum("amount"), 0) INTO from_receipt
    FROM "payment_allocations" WHERE "paymentId" = NEW."paymentId" AND "releasedOn" IS NULL;
  IF from_receipt + NEW."amount" > receipt."amount" THEN
    RAISE EXCEPTION 'A payment cannot be allocated beyond its amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payment_allocations_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION "payment_allocations_guard"();

-- A refund pays out exactly what it draws from credit: checked at commit, so
-- the refund and its source allocation can be written in either order.
CREATE FUNCTION "refunds_sourced_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" = 'REFUND' AND NEW."status" = 'POSTED'
     AND "refund_sourced"(NEW."id") <> NEW."amount" THEN
    RAISE EXCEPTION 'A refund must pay out exactly the credit it draws on (% drawn, % paid)',
      "refund_sourced"(NEW."id"), NEW."amount";
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "refunds_sourced_check"
  AFTER INSERT ON "customer_payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "refunds_sourced_check"();

-- Replaces the 4.4 guard: a void would reverse the whole sale while a credit
-- note or a payment still settles part of it.
CREATE OR REPLACE FUNCTION "invoices_credit_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF "invoice_settled"(NEW."id") > 0 THEN
    RAISE EXCEPTION 'Invoice % has credit or payments allocated to it: void those first', NEW."number";
  END IF;
  RETURN NEW;
END;
$$;
