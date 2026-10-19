export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { paymentDetail } from "@/lib/accounting/payments";
import { settlementInclude } from "@/lib/accounting/settlement";
import { bankAccountOptions } from "@/lib/accounting/bank-accounts";
import { serializeInvoiceRow, serializePayment } from "@/lib/accounting/serialize";
import { PaymentDetailClient } from "./payment-detail-client";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const payment = await prisma.customerPayment.findUnique({ where: { id }, include: paymentDetail });
  if (!payment) notFound();
  const serialized = serializePayment(payment);

  // Only unallocated money needs somewhere to go.
  const [openInvoices, bankAccounts] =
    serialized.remaining > 0
      ? await Promise.all([
          prisma.invoice
            .findMany({
              where: { contactId: payment.contactId, status: { in: ["APPROVED", "SENT", "PART_PAID"] } },
              orderBy: { issueDate: "asc" },
              include: settlementInclude,
            })
            .then((rows) => rows.map(serializeInvoiceRow).filter((i) => i.amountDue > 0)),
          bankAccountOptions(),
        ])
      : [[], []];

  return (
    <PaymentDetailClient
      payment={serialized}
      openInvoices={openInvoices.map((i) => ({ id: i.id, number: i.number, amountDue: i.amountDue }))}
      bankAccounts={bankAccounts}
      canEdit={hasPermission(session, "books:post")}
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
