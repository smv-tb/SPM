import { prisma } from "@/lib/prisma";
import { isBankAccountCode } from "./payment";

export interface BankAccountOption {
  id: string;
  code: string;
  name: string;
}

/** The live 12xx accounts money can move through, 1200 first. */
export async function bankAccountOptions(): Promise<BankAccountOption[]> {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { type: "ASSET", isArchived: false, code: { startsWith: "12" } },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  return accounts.filter((a) => isBankAccountCode(a.code));
}
