-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('POSTED', 'VOID');

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'POSTED',
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

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "releasedOn" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_journalEntryId_key" ON "supplier_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "supplier_payments_contactId_date_idx" ON "supplier_payments"("contactId", "date");

-- CreateIndex
CREATE INDEX "supplier_payments_status_date_idx" ON "supplier_payments"("status", "date");

-- CreateIndex
CREATE INDEX "bill_payment_allocations_paymentId_idx" ON "bill_payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "bill_payment_allocations_billId_idx" ON "bill_payment_allocations"("billId");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_allocations" ADD CONSTRAINT "bill_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_allocations" ADD CONSTRAINT "bill_payment_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_allocations" ADD CONSTRAINT "bill_payment_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─── Supplier payment rules ──────────────────────────────────────────────────
-- The rules src/lib/accounting/supplier-payments.ts applies, repeated where no
-- code path can get around them. The mirror of customer receipts: a payment
-- posts as it is recorded and is only ever voided; its allocations to bills
-- are released by the void, never deleted, so aged creditors as at an earlier
-- date still sees what was paid then.

ALTER TABLE "supplier_payments"
  ADD CONSTRAINT "supplier_payments_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "supplier_payments_void_check" CHECK (("status" = 'VOID') = ("voidedAt" IS NOT NULL));

ALTER TABLE "bill_payment_allocations"
  ADD CONSTRAINT "bill_payment_allocations_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "bill_payment_allocations_released_check"
    CHECK ("releasedOn" IS NULL OR "releasedOn" >= "date");

-- What has been paid against a bill.
CREATE FUNCTION "bill_settled"(bill_id text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT sum("amount") FROM "bill_payment_allocations"
                     WHERE "billId" = bill_id AND "releasedOn" IS NULL), 0)
$$;

CREATE FUNCTION "supplier_payments_guard"() RETURNS trigger
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
    IF account."type" <> 'ASSET' OR account."code" NOT BETWEEN '1200' AND '1299' OR account."isArchived" THEN
      RAISE EXCEPTION 'Account % is not a live bank account (12xx)', account."code";
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

CREATE TRIGGER "supplier_payments_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "supplier_payments"
  FOR EACH ROW EXECUTE FUNCTION "supplier_payments_guard"();

-- Locks the bill, then the payment — the order the service uses — so
-- allocations racing for one bill or one payment queue.
CREATE FUNCTION "bill_payment_allocations_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bill "bills"%ROWTYPE;
  payment "supplier_payments"%ROWTYPE;
  from_payment numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bill payment allocations are never deleted; void the payment to release them';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."releasedOn" IS NOT NULL OR NEW."releasedOn" IS NULL
       OR (to_jsonb(OLD) - 'releasedOn') IS DISTINCT FROM (to_jsonb(NEW) - 'releasedOn') THEN
      RAISE EXCEPTION 'Allocations are not edited; void the payment to release them';
    END IF;
    IF (SELECT "status" FROM "supplier_payments" WHERE "id" = NEW."paymentId") <> 'VOID' THEN
      RAISE EXCEPTION 'The payment is still live: void it to release its allocations';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."releasedOn" IS NOT NULL THEN
    RAISE EXCEPTION 'An allocation is made live; it is released only by a void';
  END IF;

  SELECT * INTO bill FROM "bills" WHERE "id" = NEW."billId" FOR UPDATE;
  IF bill."status" IN ('DRAFT', 'VOID') THEN
    RAISE EXCEPTION 'Only an approved, unvoided bill can be paid';
  END IF;
  SELECT * INTO payment FROM "supplier_payments" WHERE "id" = NEW."paymentId" FOR UPDATE;
  IF payment."status" <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted supplier payment can be allocated';
  END IF;
  IF bill."contactId" <> payment."contactId" THEN
    RAISE EXCEPTION 'That bill is from a different supplier';
  END IF;
  IF NEW."date" < bill."issueDate" OR NEW."date" < payment."date" THEN
    RAISE EXCEPTION 'An allocation cannot be dated before the bill or the payment';
  END IF;
  IF "bill_settled"(NEW."billId") + NEW."amount" > bill."total" THEN
    RAISE EXCEPTION 'The bill would be paid beyond its total';
  END IF;
  SELECT COALESCE(sum("amount"), 0) INTO from_payment
    FROM "bill_payment_allocations" WHERE "paymentId" = NEW."paymentId" AND "releasedOn" IS NULL;
  IF from_payment + NEW."amount" > payment."amount" THEN
    RAISE EXCEPTION 'A supplier payment cannot be allocated beyond its amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "bill_payment_allocations_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "bill_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION "bill_payment_allocations_guard"();

-- Voiding a bill reverses the whole purchase; while a payment still settles
-- part of it, that would leave the payment paying nothing.
CREATE FUNCTION "bills_settled_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF "bill_settled"(NEW."id") > 0 THEN
    RAISE EXCEPTION 'This bill has payments allocated to it: void those first';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bills_settled_guard"
  BEFORE UPDATE OF "status" ON "bills"
  FOR EACH ROW WHEN (NEW."status" = 'VOID' AND OLD."status" <> 'VOID')
  EXECUTE FUNCTION "bills_settled_guard"();

-- The functions from 20261029100000_add_bills, with supplier payments added:
-- a payment counts toward the supplier's retention, and anonymising clears
-- its notes like a customer payment's.

CREATE OR REPLACE FUNCTION "contact_retention_until"(p_contact text) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE
  latest date;
  start_month int;
  start_day int;
  start_year int;
  year_end date;
BEGIN
  SELECT max(d) INTO latest FROM (
    SELECT "issueDate"::date AS d FROM "invoices" WHERE "contactId" = p_contact
    UNION ALL SELECT "issueDate"::date FROM "credit_notes" WHERE "contactId" = p_contact
    UNION ALL SELECT "date"::date FROM "customer_payments" WHERE "contactId" = p_contact
    UNION ALL SELECT "issueDate"::date FROM "bills" WHERE "contactId" = p_contact
    UNION ALL SELECT "date"::date FROM "supplier_payments" WHERE "contactId" = p_contact
  ) documents;
  IF latest IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT "yearStartMonth", "yearStartDay" INTO start_month, start_day FROM "company_settings" LIMIT 1;
  start_month := COALESCE(start_month, 4);
  start_day := COALESCE(start_day, 1);

  start_year := EXTRACT(YEAR FROM latest)::int;
  IF latest < make_date(start_year, start_month, start_day) THEN
    start_year := start_year - 1;
  END IF;
  year_end := make_date(start_year + 1, start_month, start_day) - 1;
  RETURN (year_end + INTERVAL '6 years')::date;
END;
$$;

CREATE OR REPLACE FUNCTION "anonymise_contact"(p_contact text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  until_day date;
BEGIN
  PERFORM 1 FROM "contacts" WHERE "id" = p_contact FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: no such contact' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "contacts" WHERE "id" = p_contact AND "anonymisedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'CONTACT_ANONYMISED: this contact is already anonymised' USING ERRCODE = 'P0001';
  END IF;
  IF "contact_has_open_documents"(p_contact) THEN
    RAISE EXCEPTION 'CONTACT_OPEN_DOCUMENTS: the contact has draft, unpaid or part-paid documents' USING ERRCODE = 'P0001';
  END IF;
  until_day := "contact_retention_until"(p_contact);
  IF until_day IS NOT NULL AND until_day >= "business_today"() THEN
    RAISE EXCEPTION 'CONTACT_RETENTION: documents must be kept until % ', until_day USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('smartvie.anonymising', p_contact, true);

  UPDATE "invoices" SET "billToName" = 'Anonymised contact', "billToAddress" = NULL, "shipToAddress" = NULL,
    "taxId" = NULL, "notes" = NULL WHERE "contactId" = p_contact;
  UPDATE "credit_notes" SET "billToName" = 'Anonymised contact', "billToAddress" = NULL, "shipToAddress" = NULL,
    "taxId" = NULL, "notes" = NULL WHERE "contactId" = p_contact;
  UPDATE "customer_payments" SET "notes" = NULL WHERE "contactId" = p_contact;
  UPDATE "bills" SET "supplierName" = 'Anonymised contact', "notes" = NULL WHERE "contactId" = p_contact;
  UPDATE "supplier_payments" SET "notes" = NULL WHERE "contactId" = p_contact;
  -- The supplier's own documents carry their details: past retention they go.
  DELETE FROM "bill_attachments"
    WHERE "billId" IN (SELECT "id" FROM "bills" WHERE "contactId" = p_contact);
  UPDATE "contacts" SET
    "name" = 'Anonymised contact ' || "id",
    "email" = NULL, "phone" = NULL, "taxId" = NULL, "billingAddress" = NULL,
    "shippingAddress" = NULL, "notes" = NULL,
    "isArchived" = true, "anonymisedAt" = now()
    WHERE "id" = p_contact;

  PERFORM set_config('smartvie.anonymising', '', true);
END;
$$;
