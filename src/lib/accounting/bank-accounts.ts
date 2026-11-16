import { prisma } from "@/lib/prisma";
import { isBankAccountCode, isCardAccountCode } from "./payment";

export interface BankAccountOption {
  id: string;
  code: string;
  name: string;
}

/**
 * The live 12xx accounts money can move through, 1200 first. With `cards`,
 * the 20xx credit card accounts follow them: a supplier can be paid by card,
 * a customer cannot pay into one.
 */
export async function bankAccountOptions(options: { cards?: boolean } = {}): Promise<BankAccountOption[]> {
  const [banks, cards] = await Promise.all([
    prisma.ledgerAccount.findMany({
      where: { type: "ASSET", isArchived: false, code: { startsWith: "12" } },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    options.cards ? cardAccountOptions() : [],
  ]);
  return [...banks.filter((a) => isBankAccountCode(a.code)), ...cards];
}

/** The live 20xx liability accounts a company credit card can book to. */
export async function cardAccountOptions(): Promise<BankAccountOption[]> {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { type: "LIABILITY", isArchived: false, code: { startsWith: "20" } },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  return accounts.filter((a) => isCardAccountCode(a.code));
}
