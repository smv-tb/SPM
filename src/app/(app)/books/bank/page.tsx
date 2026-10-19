export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { bankPosition } from "@/lib/accounting/statements";
import { serializeBankAccount } from "@/lib/accounting/serialize";
import { bankAccountOptions } from "@/lib/accounting/bank-accounts";
import { BankAccountsClient } from "./bank-accounts-client";

export default async function BankAccountsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const accounts = await prisma.bankAccount.findMany({
    orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    include: { ledgerAccount: { select: { code: true, name: true } } },
  });
  const positions = await Promise.all(accounts.map((a) => bankPosition(prisma, a)));
  const canSetUp = hasPermission(session, "books:settings");
  // 12xx accounts not yet tied to a real bank account.
  const linked = new Set(accounts.map((a) => a.ledgerAccountId));
  const available = canSetUp ? (await bankAccountOptions()).filter((a) => !linked.has(a.id)) : [];

  return (
    <BankAccountsClient
      accounts={accounts.map((a, i) => serializeBankAccount(a, positions[i]))}
      ledgerAccounts={available}
      canSetUp={canSetUp}
    />
  );
}
