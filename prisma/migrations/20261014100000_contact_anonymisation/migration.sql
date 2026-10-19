-- Privacy and retention (S3.6).
--
-- Company records have to be kept for six years after the end of the financial
-- year they belong to. After that, the personal details of a customer or
-- supplier no longer have a reason to be held. Anonymising a contact replaces
-- those details on the contact AND on the customer snapshot printed on its
-- invoices and credit notes, which the approval guards otherwise freeze.
--
-- The rule lives here, not only in the application, for the same reason as the
-- ledger rules: a script or a psql session must not be able to scrub a
-- document that is still inside its retention window.

ALTER TABLE "contacts" ADD COLUMN "anonymisedAt" TIMESTAMP(3);

-- The business day, in the company's time zone (matches BUSINESS_TIME_ZONE).
CREATE FUNCTION "business_today"() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Europe/London')::date
$$;

-- The day after which nothing about this contact needs keeping: six years after
-- the end of the financial year of its most recent document (invoice, credit
-- note or payment, voided ones included). NULL when it has no documents.
CREATE FUNCTION "contact_retention_until"(p_contact text) RETURNS date
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

-- Money still moving, or a document not yet finished, keeps the contact.
CREATE FUNCTION "contact_has_open_documents"(p_contact text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "invoices" WHERE "contactId" = p_contact AND "status" IN ('DRAFT', 'APPROVED', 'SENT', 'PART_PAID'))
      OR EXISTS (SELECT 1 FROM "credit_notes" WHERE "contactId" = p_contact AND "status" = 'DRAFT')
$$;

CREATE FUNCTION "contact_retention_ok"(p_contact text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "contacts" WHERE "id" = p_contact)
     AND NOT "contact_has_open_documents"(p_contact)
     AND COALESCE("contact_retention_until"(p_contact) < "business_today"(), true)
$$;

-- True only inside anonymise_contact for a contact that is past retention. The
-- setting alone is not enough: the retention rule is re-checked, so setting it
-- by hand unlocks nothing that was not already free to scrub.
CREATE FUNCTION "contact_anonymising"(p_contact text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('smartvie.anonymising', true), '') = p_contact
     AND "contact_retention_ok"(p_contact)
$$;

CREATE OR REPLACE FUNCTION "invoices_guard"() RETURNS trigger
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

  unchanged := NEW;
  unchanged."status" := OLD."status";
  unchanged."sentAt" := OLD."sentAt";
  unchanged."notes" := OLD."notes";
  unchanged."updatedAt" := OLD."updatedAt";
  unchanged."createdById" := OLD."createdById";
  unchanged."approvedById" := OLD."approvedById";

  -- Past its retention period, the customer snapshot may be replaced by the
  -- anonymisation below, and only that.
  IF "contact_anonymising"(OLD."contactId") THEN
    unchanged."billToName" := OLD."billToName";
    unchanged."billToAddress" := OLD."billToAddress";
    unchanged."shipToAddress" := OLD."shipToAddress";
    unchanged."taxId" := OLD."taxId";
  END IF;

  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL)
     OR (NEW."approvedById" IS DISTINCT FROM OLD."approvedById" AND NEW."approvedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'Invoice % is approved: correct it with a credit note, not an edit', OLD."number";
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "credit_notes_guard"() RETURNS trigger
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

  IF "contact_anonymising"(OLD."contactId") THEN
    unchanged."billToName" := OLD."billToName";
    unchanged."billToAddress" := OLD."billToAddress";
    unchanged."shipToAddress" := OLD."shipToAddress";
    unchanged."taxId" := OLD."taxId";
  END IF;

  IF unchanged IS DISTINCT FROM OLD
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL)
     OR (NEW."approvedById" IS DISTINCT FROM OLD."approvedById" AND NEW."approvedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'Credit note % is approved: it cannot be edited, only voided', OLD."number";
  END IF;

  RETURN NEW;
END;
$$;

-- The only way personal details leave a contact and its documents. Runs as the
-- schema owner so the app's rows-only role can call it without being able to
-- touch the frozen columns any other way.
CREATE FUNCTION "anonymise_contact"(p_contact text) RETURNS void
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
  UPDATE "contacts" SET
    "name" = 'Anonymised contact ' || "id",
    "email" = NULL, "phone" = NULL, "taxId" = NULL, "billingAddress" = NULL,
    "shippingAddress" = NULL, "notes" = NULL,
    "isArchived" = true, "anonymisedAt" = now()
    WHERE "id" = p_contact;

  PERFORM set_config('smartvie.anonymising', '', true);
END;
$$;

-- EXECUTE stays with PUBLIC (the default) so whichever role the app connects as can call it;
-- the function enforces the retention rule itself, whoever calls it.
