-- Bank account numbers at rest (S3.1). The column now holds either the plain eight
-- digits (a row not yet converted by scripts/encrypt-bank-numbers.ts) or a sealed
-- value `v1.<keyId>.<iv>.<ciphertext>.<tag>`. Uniqueness moves to a keyed blind index
-- for sealed rows and stays on the plain value for legacy rows.

DROP INDEX "bank_accounts_sortCode_accountNumber_key";

ALTER TABLE "bank_accounts" ADD COLUMN "accountNumberIdx" TEXT;

CREATE UNIQUE INDEX "bank_accounts_accountNumberIdx_key" ON "bank_accounts"("accountNumberIdx");

-- Legacy rows keep the old guarantee until they are converted.
CREATE UNIQUE INDEX "bank_accounts_plain_details_key"
  ON "bank_accounts"("sortCode", "accountNumber")
  WHERE "accountNumber" !~ '^v1\.';

ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_account_number_check";
ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_account_number_check"
    CHECK ("accountNumber" ~ '^[0-9]{8}$' OR "accountNumber" ~ '^v1(\.[A-Za-z0-9_-]+){4}$'),
  ADD CONSTRAINT "bank_accounts_sealed_indexed_check"
    CHECK ("accountNumber" !~ '^v1\.' OR "accountNumberIdx" IS NOT NULL);
