export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { billSettlementInclude, supplierPaymentDetail } from "@/lib/accounting/supplier-payments";
import { serializeBillRow, serializeSupplierPayment } from "@/lib/accounting/serialize";
import { SupplierPaymentDetailClient } from "./supplier-payment-detail-client";

export default async function SupplierPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const payment = await prisma.supplierPayment.findUnique({ where: { id }, include: supplierPaymentDetail });
  if (!payment) notFound();
  const serialized = serializeSupplierPayment(payment);

  // Only money paid on account needs somewhere to go.
  const openBills =
    serialized.remaining > 0
      ? (
          await prisma.bill.findMany({
            where: { contactId: payment.contactId, status: { in: ["APPROVED", "PART_PAID"] } },
            orderBy: { issueDate: "asc" },
            include: billSettlementInclude,
          })
        )
          .map(serializeBillRow)
          .filter((b) => b.amountDue > 0)
      : [];

  return (
    <SupplierPaymentDetailClient
      payment={serialized}
      openBills={openBills.map((b) => ({ id: b.id, label: b.supplierReference ?? `Bill of ${b.issueDate}`, amountDue: b.amountDue }))}
      canEdit={hasPermission(session, "books:post")}
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
