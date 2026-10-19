export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeBankAccount } from "@/lib/accounting/serialize";
import { StatementImportClient } from "./statement-import-client";

export default async function StatementImportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:post")) redirect("/books/bank");

  const { id } = await params;
  const account = await prisma.bankAccount.findUnique({
    where: { id },
    include: { ledgerAccount: { select: { code: true, name: true } } },
  });
  if (!account) notFound();

  return <StatementImportClient account={serializeBankAccount(account)} />;
}
