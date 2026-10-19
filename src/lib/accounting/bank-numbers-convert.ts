import type { Prisma } from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";
import {
  SETTINGS_NUMBER_CONTEXT, bankAccountIndex, bankAccountNumberContext, isSealed, openNumber, sealNumber,
} from "./bank-numbers";
import { COMPANY_SETTINGS_ID } from "./posting";

/**
 * One-off conversion of rows written before account numbers were encrypted
 * (S3.1). Run by `scripts/encrypt-bank-numbers.ts`; safe to repeat — rows that
 * are already sealed are left alone. Each conversion is read back and compared
 * before it is kept, so a wrong key can't turn a number into something unreadable.
 *
 * An exception to "statements.ts is the only writer of BankAccount": it changes
 * how a value is stored, never what it is.
 */
type Tx = Prisma.TransactionClient;

export interface ConvertResult {
  bankAccounts: number;
  settings: boolean;
}

export async function sealLegacyBankNumbers(tx: Tx, actor: AuditActor, dryRun: boolean): Promise<ConvertResult> {
  const result: ConvertResult = { bankAccounts: 0, settings: false };

  const accounts = await tx.bankAccount.findMany();
  for (const account of accounts) {
    if (isSealed(account.accountNumber)) continue;
    const context = bankAccountNumberContext(account.id);
    const sealed = sealNumber(account.accountNumber, context);
    if (openNumber(sealed, context) !== account.accountNumber) throw new Error(`Read-back failed for bank account ${account.id}`);
    result.bankAccounts++;
    if (dryRun) continue;
    await tx.bankAccount.update({
      where: { id: account.id },
      data: { accountNumber: sealed, accountNumberIdx: bankAccountIndex(account.sortCode, account.accountNumber) },
    });
    await recordAudit(tx, {
      actor, action: "bank_account.encrypt", entityType: "BankAccount", entityId: account.id,
      after: { accountNumber: "sealed" },
    });
  }

  const settings = await tx.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });
  if (settings?.bankAccountNumber && !isSealed(settings.bankAccountNumber)) {
    const sealed = sealNumber(settings.bankAccountNumber, SETTINGS_NUMBER_CONTEXT);
    if (openNumber(sealed, SETTINGS_NUMBER_CONTEXT) !== settings.bankAccountNumber) throw new Error("Read-back failed for company settings");
    result.settings = true;
    if (!dryRun) {
      await tx.companySettings.update({ where: { id: COMPANY_SETTINGS_ID }, data: { bankAccountNumber: sealed } });
      await recordAudit(tx, {
        actor, action: "company_settings.encrypt", entityType: "CompanySettings", entityId: COMPANY_SETTINGS_ID,
        after: { bankAccountNumber: "sealed" },
      });
    }
  }
  return result;
}
