export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { AccountsClient, type AccountRow } from "./accounts-client";

export default async function AccountsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const [accounts, movements, usage] = await Promise.all([
    prisma.ledgerAccount.findMany({ orderBy: { code: "asc" } }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    }),
    // Any line, draft or posted, makes an account "in use" for deletion.
    prisma.journalLine.groupBy({ by: ["accountId"], _count: { _all: true } }),
  ]);

  const balances = new Map(
    movements.map((m) => [m.accountId, toPence(m._sum.debit ?? 0) - toPence(m._sum.credit ?? 0)])
  );
  const used = new Set(usage.map((u) => u.accountId));

  const rows: AccountRow[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    description: a.description,
    isSystem: a.isSystem,
    isArchived: a.isArchived,
    balance: balances.get(a.id) ?? 0,
    inUse: used.has(a.id),
  }));

  return (
    <AccountsClient
      accounts={rows}
      canPost={hasPermission(session, "books:post")}
      canManage={hasPermission(session, "books:settings")}
    />
  );
}
