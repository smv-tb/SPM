import { prisma } from "@/lib/prisma";
import { isBillAccount } from "./bill";
import type { BillAccountOption, BillSupplier } from "@/components/books/BillForm";

/** What the bill form offers: live suppliers, and the accounts a bill line may use. */
export async function loadBillFormOptions(): Promise<{ suppliers: BillSupplier[]; accounts: BillAccountOption[] }> {
  const [suppliers, accounts] = await Promise.all([
    prisma.contact.findMany({
      where: { isArchived: false, type: { in: ["SUPPLIER", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, paymentTermsDays: true },
    }),
    prisma.ledgerAccount.findMany({
      where: { isArchived: false, type: { in: ["EXPENSE", "ASSET"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
  ]);
  return { suppliers, accounts: accounts.filter(isBillAccount) };
}
