export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeSupplierPaymentRow } from "@/lib/accounting/serialize";
import { bankAccountOptions } from "@/lib/accounting/bank-accounts";
import { SupplierPaymentsClient } from "./supplier-payments-client";

const PAGE_SIZE = 50;

export default async function SupplierPaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const params = await searchParams;
  const total = await prisma.supplierPayment.count();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(params.page ?? "1", 10) || 1), pages);

  const canEdit = hasPermission(session, "books:post");
  const [payments, suppliers, bankAccounts] = await Promise.all([
    prisma.supplierPayment.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { contact: { select: { id: true, name: true } }, allocations: { where: { releasedOn: null }, select: { amount: true } } },
    }),
    canEdit
      ? prisma.contact.findMany({
          where: { isArchived: false, type: { in: ["SUPPLIER", "BOTH"] } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
    canEdit ? bankAccountOptions() : [],
  ]);

  return (
    <SupplierPaymentsClient
      payments={payments.map(serializeSupplierPaymentRow)}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      suppliers={suppliers}
      bankAccounts={bankAccounts}
      canEdit={canEdit}
    />
  );
}
