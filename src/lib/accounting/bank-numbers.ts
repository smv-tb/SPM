import { blindIndex, blindIndexes, decryptField, encryptField, type Keyring, defaultKeyring } from "@/lib/crypto";

/**
 * Bank account numbers at rest (S3.1). The column holds either a sealed value
 * (`v1.<keyId>.…`, AES-256-GCM via `crypto.ts`) or — for a row written before
 * encryption and not yet converted by `scripts/encrypt-bank-numbers.ts` — the
 * plain eight digits. Everything reads through `openNumber`, so both work and
 * the conversion can happen whenever the operator runs it.
 *
 * - Each sealed value is bound to its row (`bank_account:<id>:number`, or the
 *   settings row), so a ciphertext copied elsewhere will not open.
 * - Uniqueness of (sort code, number) moves to `BankAccount.accountNumberIdx`, a
 *   keyed blind index, since two encryptions of one number never match.
 * - Responses and audit rows carry only `maskNumber(…)`, never the number.
 *
 * Server-only: it needs the encryption keys.
 */
export const SETTINGS_NUMBER_CONTEXT = "company_settings:bank_account_number";
export const bankAccountNumberContext = (id: string) => `bank_account:${id}:number`;
const INDEX_CONTEXT = "bank_account:sort_code+number";

export const isSealed = (stored: string): boolean => stored.startsWith("v1.");

/** The plain number, whether the stored value is sealed or still legacy plaintext. */
export function openNumber(stored: string, context: string, ring?: Keyring): string {
  return isSealed(stored) ? decryptField(stored, context, ring) : stored;
}

export const sealNumber = (plain: string, context: string, ring?: Keyring): string =>
  encryptField(plain, context, ring);

/** `••••1234` — the last four digits of whatever was typed. */
export const maskNumber = (plain: string | null | undefined): string | null =>
  plain ? `••••${plain.slice(-4)}` : null;

const indexValue = (sortCode: string, number: string) => `${sortCode}:${number}`;

/** The index to store for a bank account. */
export const bankAccountIndex = (sortCode: string, number: string, ring?: Keyring): string =>
  blindIndex(indexValue(sortCode, number), INDEX_CONTEXT, ring);

/** Every index this account could be stored under (any key in the ring), for duplicate checks. */
export const bankAccountIndexCandidates = (sortCode: string, number: string, ring?: Keyring): string[] =>
  blindIndexes(indexValue(sortCode, number), INDEX_CONTEXT, ring);

/** Where to look for an existing account with these details: sealed rows by index, legacy rows by value. */
export function duplicateWhere(sortCode: string, number: string, ring: Keyring = defaultKeyring()) {
  return {
    OR: [
      { accountNumberIdx: { in: bankAccountIndexCandidates(sortCode, number, ring) } },
      { sortCode, accountNumber: number },
    ],
  };
}

/**
 * A bank account as the audit log may see it: the number masked and a keyed
 * reference so a change to the *first* digits still shows as a change.
 */
export function auditableBankAccount<T extends { id: string; sortCode: string; accountNumber: string }>(
  row: T,
  ring?: Keyring
): Omit<T, "accountNumber" | "accountNumberIdx"> & { accountNumber: string | null; numberRef: string } {
  const { accountNumber, ...rest } = row as T & { accountNumberIdx?: unknown };
  delete (rest as { accountNumberIdx?: unknown }).accountNumberIdx;
  const plain = openNumber(accountNumber, bankAccountNumberContext(row.id), ring);
  return {
    ...(rest as Omit<T, "accountNumber" | "accountNumberIdx">),
    accountNumber: maskNumber(plain),
    numberRef: bankAccountIndex(row.sortCode, plain, ring).slice(0, 24),
  };
}

/** The same for the company's invoice bank details. */
export function auditableSettings<T extends { bankAccountNumber: string | null }>(
  row: T | null,
  ring?: Keyring
) {
  if (!row) return row;
  const plain = row.bankAccountNumber ? openNumber(row.bankAccountNumber, SETTINGS_NUMBER_CONTEXT, ring) : null;
  return {
    ...row,
    bankAccountNumber: maskNumber(plain),
    bankAccountNumberRef: plain ? blindIndex(plain, SETTINGS_NUMBER_CONTEXT, ring).slice(0, 24) : null,
  };
}

/**
 * For lists: the masked number, or a marker when the value cannot be opened (the
 * key is missing or was removed too early). One unreadable number must not take
 * down the screen you would use to find out why; anything that needs the real
 * number — importing a statement — still fails loudly.
 */
export function maskedNumberOrUnreadable(stored: string, context: string, ring?: Keyring): string {
  try {
    return maskNumber(openNumber(stored, context, ring)) ?? "••••";
  } catch {
    return "•••• (unreadable — check DATA_ENCRYPTION_KEYS)";
  }
}
