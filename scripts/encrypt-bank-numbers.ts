/**
 * Encrypts bank account numbers written before field encryption (S3.1).
 *
 *   DATABASE_URL=… DATA_ENCRYPTION_KEYS=… yarn encrypt:bank-numbers           # report only
 *   DATABASE_URL=… DATA_ENCRYPTION_KEYS=… yarn encrypt:bank-numbers --apply   # convert
 *
 * Idempotent: rows already sealed are skipped. Run it after `prisma migrate
 * deploy` (the migration adds the index column and relaxes the constraints), from
 * a machine that can reach the database. The app reads both forms in the
 * meantime, so there is no deadline. Back up DATA_ENCRYPTION_KEYS first — a
 * sealed number is unreadable without it.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { sealLegacyBankNumbers } from "@/lib/accounting/bank-numbers-convert";
import { parseKeyring } from "@/lib/crypto";

const apply = process.argv.includes("--apply");

async function main() {
  parseKeyring(process.env.DATA_ENCRYPTION_KEYS); // fails early, with a clear message, when the keys are missing

  const result = await prisma.$transaction(
    (tx) => sealLegacyBankNumbers(tx, { type: "SYSTEM", label: "encrypt-bank-numbers" }, !apply),
    { timeout: 60_000 }
  );

  const verb = apply ? "Encrypted" : "Would encrypt";
  console.log(`${verb} ${result.bankAccounts} bank account number(s)${result.settings ? " and the company invoice bank details" : ""}.`);
  if (!apply && (result.bankAccounts > 0 || result.settings)) console.log("Run again with --apply to do it.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
