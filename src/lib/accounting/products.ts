import type { Prisma } from "@prisma/client";
import { AccountingError } from "./errors";

/**
 * A product's income account must be a live income account: approving an
 * invoice built on it credits the sale there.
 *
 * The database enforces the same rule (trigger `products_income_account_guard`
 * in the contacts/products migration); this runs first so the form gets a
 * message it can show instead of a failed transaction.
 */
export async function assertIncomeAccount(
  tx: Prisma.TransactionClient,
  accountId: string | null | undefined
): Promise<void> {
  if (!accountId) return;

  const account = await tx.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new AccountingError("UNKNOWN_ACCOUNT", "That account does not exist", 422);
  }
  if (account.type !== "INCOME") {
    throw new AccountingError(
      "NOT_INCOME_ACCOUNT",
      `${account.code} ${account.name} is not an income account`,
      422
    );
  }
  if (account.isArchived) {
    throw new AccountingError(
      "ARCHIVED_ACCOUNT",
      `${account.code} ${account.name} is archived and cannot take new sales`,
      422
    );
  }
}
