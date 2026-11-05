export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeBill } from "@/lib/accounting/serialize";
import { billDetail } from "@/lib/accounting/bills";
import { loadBillFormOptions } from "@/lib/accounting/bill-options";
import { bankAccountOptions } from "@/lib/accounting/bank-accounts";
import { BillDetailClient } from "./bill-detail-client";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: billDetail,
  });
  if (!bill) notFound();

  // Only a draft can be edited, so the pickers are only needed then.
  const options = bill.status === "DRAFT" ? await loadBillFormOptions() : { suppliers: [], accounts: [] };
  // And only an open bill can be paid.
  const payable = bill.status === "APPROVED" || bill.status === "PART_PAID";
  const bankAccounts = payable && hasPermission(session, "books:post") ? await bankAccountOptions() : [];

  return (
    <BillDetailClient
      bill={serializeBill(bill)}
      suppliers={options.suppliers}
      accounts={options.accounts}
      bankAccounts={bankAccounts}
      canEdit={hasPermission(session, "books:post")}
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
