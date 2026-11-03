export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeBill } from "@/lib/accounting/serialize";
import { attachmentMeta } from "@/lib/accounting/bills";
import { loadBillFormOptions } from "@/lib/accounting/bill-options";
import { BillDetailClient } from "./bill-detail-client";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNumber: "asc" }, include: { account: { select: { code: true, name: true } } } },
      attachments: { select: attachmentMeta, orderBy: { createdAt: "asc" } },
      journalEntry: { select: { id: true, number: true } },
    },
  });
  if (!bill) notFound();

  // Only a draft can be edited, so the pickers are only needed then.
  const options = bill.status === "DRAFT" ? await loadBillFormOptions() : { suppliers: [], accounts: [] };

  return (
    <BillDetailClient
      bill={serializeBill(bill)}
      suppliers={options.suppliers}
      accounts={options.accounts}
      canEdit={hasPermission(session, "books:post")}
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
