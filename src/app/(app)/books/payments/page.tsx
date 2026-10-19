export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializePaymentRow } from "@/lib/accounting/serialize";
import { bankAccountOptions } from "@/lib/accounting/bank-accounts";
import type { PaymentKind } from "@/lib/accounting/payment";
import { PaymentsClient } from "./payments-client";

const PAGE_SIZE = 50;

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const params = await searchParams;
  const kind: PaymentKind | null = params.kind === "RECEIPT" || params.kind === "REFUND" ? params.kind : null;
  const where = kind ? { kind } : {};

  const total = await prisma.customerPayment.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(params.page ?? "1", 10) || 1), pages);

  const canEdit = hasPermission(session, "books:post");
  const [payments, customers, bankAccounts] = await Promise.all([
    prisma.customerPayment.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { contact: { select: { id: true, name: true } }, allocations: { where: { releasedOn: null }, select: { amount: true } } },
    }),
    canEdit
      ? prisma.contact.findMany({
          where: { isArchived: false, type: { in: ["CUSTOMER", "BOTH"] } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
    canEdit ? bankAccountOptions() : [],
  ]);

  return (
    <PaymentsClient
      payments={payments.map(serializePaymentRow)}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      kind={kind}
      customers={customers}
      bankAccounts={bankAccounts}
      canEdit={canEdit}
    />
  );
}
