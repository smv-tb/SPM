-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'APPROVED', 'PART_PAID', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'DRAFT',
    "contactId" TEXT NOT NULL,
    "supplierReference" TEXT,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "notes" TEXT,
    "supplierName" TEXT NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_lines" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatCode" TEXT,
    "accountId" TEXT,

    CONSTRAINT "bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_attachments" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bills_journalEntryId_key" ON "bills"("journalEntryId");

-- CreateIndex
CREATE INDEX "bills_status_issueDate_idx" ON "bills"("status", "issueDate");

-- CreateIndex
CREATE INDEX "bills_contactId_idx" ON "bills"("contactId");

-- CreateIndex
CREATE INDEX "bills_dueDate_idx" ON "bills"("dueDate");

-- CreateIndex
CREATE INDEX "bill_lines_accountId_idx" ON "bill_lines"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_lines_billId_lineNumber_key" ON "bill_lines"("billId", "lineNumber");

-- CreateIndex
CREATE INDEX "bill_attachments_billId_idx" ON "bill_attachments"("billId");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─── Bill rules ──────────────────────────────────────────────────────────────
-- The same rules src/lib/accounting/bills.ts applies, repeated where no code
-- path — Hermes, a script, a psql session — can get around them.

ALTER TABLE "bills"
  ADD CONSTRAINT "bills_due_after_issue_check" CHECK ("dueDate" >= "issueDate"),
  ADD CONSTRAINT "bills_name_check" CHECK (length(btrim("supplierName")) > 0),
  ADD CONSTRAINT "bills_reference_check"
    CHECK ("supplierReference" IS NULL OR length(btrim("supplierReference")) > 0),
  ADD CONSTRAINT "bills_total_check" CHECK ("total" = "subtotal"),
  -- Approval posts the journal, so a live bill has one.
  ADD CONSTRAINT "bills_journal_check"
    CHECK ("status" IN ('DRAFT', 'VOID') OR "journalEntryId" IS NOT NULL);

-- The failure that matters is the same supplier invoice entered twice. A void
-- bill frees its reference, so a mistake can be voided and entered again.
CREATE UNIQUE INDEX "bills_supplier_reference_key"
  ON "bills" ("contactId", lower(btrim("supplierReference")))
  WHERE "status" <> 'VOID' AND "supplierReference" IS NOT NULL;

ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_description_check" CHECK (length(btrim("description")) > 0),
  ADD CONSTRAINT "bill_lines_price_check" CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "bill_lines_quantity_check" CHECK ("quantity" > 0),
  -- numeric round() is half away from zero, the rule `lineAmountPence` applies.
  ADD CONSTRAINT "bill_lines_amount_check"
    CHECK ("amount" = round("quantity" * "unitPrice", 2));

ALTER TABLE "bill_attachments"
  ADD CONSTRAINT "bill_attachments_name_check"
    CHECK (length(btrim("fileName")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "bill_attachments_type_check"
    CHECK ("contentType" IN ('application/pdf', 'image/png', 'image/jpeg')),
  ADD CONSTRAINT "bill_attachments_size_check"
    CHECK ("size" = octet_length("data") AND "size" BETWEEN 1 AND 5242880),
  ADD CONSTRAINT "bill_attachments_hash_check"
    CHECK ("sha256" = encode(sha256("data"), 'hex'));

-- What a bill line may debit: an expense, or an asset bought on credit (fixed
-- assets, prepayments, other debtors) — never trade debtors or a bank, which
-- have their own documents. Mirrored by `isBillAccount` in bill.ts.
CREATE FUNCTION "bill_lines_account_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account "ledger_accounts"%ROWTYPE;
BEGIN
  IF NEW."accountId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO account FROM "ledger_accounts" WHERE "id" = NEW."accountId";
  IF NOT (account."type" = 'EXPENSE'
          OR (account."type" = 'ASSET' AND account."code" <> '1100' AND account."code" NOT LIKE '12%')) THEN
    RAISE EXCEPTION 'Account % cannot take a bill line: choose an expense account, or an asset that is not trade debtors or a bank',
      account."code";
  END IF;
  IF account."isArchived" THEN
    RAISE EXCEPTION 'Account % is archived and cannot take new bills', account."code";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "bill_lines_account_guard"
  BEFORE INSERT OR UPDATE OF "accountId" ON "bill_lines"
  FOR EACH ROW EXECUTE FUNCTION "bill_lines_account_guard"();

-- Once a bill is approved its figures, dates and supplier are fixed. Being
-- paid or voided still has to be recordable, so only that narrow set of
-- columns may move afterwards.
CREATE FUNCTION "bills_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unchanged "bills"%ROWTYPE;
  supplier_type "ContactType";
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Bills are created as drafts and then approved';
  END IF;

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD."status" = 'DRAFT') THEN
    SELECT "type" INTO supplier_type FROM "contacts" WHERE "id" = NEW."contactId";
    IF supplier_type = 'CUSTOMER' THEN
      RAISE EXCEPTION 'A bill must be from a supplier (or a contact who is both)';
    END IF;
    -- Approval is the moment every line needs somewhere to go.
    IF TG_OP = 'UPDATE' AND NEW."status" = 'APPROVED' AND EXISTS (
         SELECT 1 FROM "bill_lines" WHERE "billId" = NEW."id" AND "accountId" IS NULL) THEN
      RAISE EXCEPTION 'Every line of a bill needs an account before it is approved';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'DRAFT' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Bill % is approved and cannot be deleted; void it instead', OLD."id";
  END IF;

  IF OLD."status" = 'VOID' AND NEW."status" <> 'VOID' THEN
    RAISE EXCEPTION 'Bill % is void, and a void is final', OLD."id";
  END IF;
  IF NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'Bill % is approved and cannot go back to draft', OLD."id";
  END IF;

  -- Everything except the columns that legitimately move after approval must
  -- match. (A deleted user's id being nulled by ON DELETE SET NULL is allowed:
  -- who approved it survives in the audit log.)
  unchanged := NEW;
  unchanged."status" := OLD."status";
  unchanged."notes" := OLD."notes";
  unchanged."updatedAt" := OLD."updatedAt";
  unchanged."createdById" := OLD."createdById";
  unchanged."approvedById" := OLD."approvedById";

  -- Past its retention period, the supplier snapshot may be replaced by
  -- anonymise_contact, and only that.
  IF "contact_anonymising"(OLD."contactId") THEN
    unchanged."supplierName" := OLD."supplierName";
  END IF;

  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL)
     OR (NEW."approvedById" IS DISTINCT FROM OLD."approvedById" AND NEW."approvedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'Bill % is approved: it cannot be edited, only voided', OLD."id";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "bills_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "bills"
  FOR EACH ROW EXECUTE FUNCTION "bills_guard"();

-- The lines of an approved bill are part of that fixed document.
CREATE FUNCTION "bill_lines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bill_status "BillStatus";
BEGIN
  SELECT "status" INTO bill_status FROM "bills" WHERE "id" = COALESCE(NEW."billId", OLD."billId");

  -- No row means the draft is being deleted and its lines are cascading.
  IF bill_status IS NULL OR bill_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'Bill % is approved: its lines cannot be changed', COALESCE(NEW."billId", OLD."billId");
END;
$$;

CREATE TRIGGER "bill_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "bill_lines"
  FOR EACH ROW EXECUTE FUNCTION "bill_lines_guard"();

-- An attachment is evidence: never edited, removable only while its bill is a
-- draft (or by anonymisation, once past retention). One can still be added
-- after approval — the paper often arrives later — but not to a void bill.
CREATE FUNCTION "bill_attachments_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bill_status "BillStatus";
  bill_contact text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Bill attachments cannot be changed; remove and upload again while the bill is a draft';
  END IF;

  SELECT "status", "contactId" INTO bill_status, bill_contact
    FROM "bills" WHERE "id" = COALESCE(NEW."billId", OLD."billId");

  IF TG_OP = 'INSERT' THEN
    IF bill_status = 'VOID' THEN
      RAISE EXCEPTION 'Bill % is void: nothing more can be attached to it', NEW."billId";
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE. No row means a draft bill is being deleted and this cascades.
  IF bill_status IS NULL OR bill_status = 'DRAFT' OR "contact_anonymising"(bill_contact) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Bill % is approved: its attachments are kept as evidence', OLD."billId";
END;
$$;

CREATE TRIGGER "bill_attachments_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "bill_attachments"
  FOR EACH ROW EXECUTE FUNCTION "bill_attachments_guard"();


-- ─── Privacy and retention (S3.6) now covers suppliers' bills ────────────────
-- The functions from 20261014100000_contact_anonymisation, with bills added:
-- a bill counts toward retention, an unpaid one keeps the contact, and
-- anonymising scrubs the supplier snapshot and removes the attached documents.

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

CREATE OR REPLACE FUNCTION "contact_has_open_documents"(p_contact text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "invoices" WHERE "contactId" = p_contact AND "status" IN ('DRAFT', 'APPROVED', 'SENT', 'PART_PAID'))
      OR EXISTS (SELECT 1 FROM "credit_notes" WHERE "contactId" = p_contact AND "status" = 'DRAFT')
      OR EXISTS (SELECT 1 FROM "bills" WHERE "contactId" = p_contact AND "status" IN ('DRAFT', 'APPROVED', 'PART_PAID'))
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
