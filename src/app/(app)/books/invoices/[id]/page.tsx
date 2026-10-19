export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { serializeInvoice } from "@/lib/accounting/serialize";
import { bankAccountOptions } from "@/lib/accounting/bank-accounts";
import { loadBankChangeNotice } from "@/lib/accounting/bank-details-change";
import { InvoiceDetailClient } from "./invoice-detail-client";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      journalEntry: { select: { id: true, number: true } },
      contact: { select: { id: true, name: true } },
      creditAllocations: {
        where: { releasedOn: null },
        orderBy: { createdAt: "asc" },
        include: { creditNote: { select: { id: true, number: true } } },
      },
      paymentAllocations: {
        where: { releasedOn: null },
        orderBy: { createdAt: "asc" },
        include: { payment: { select: { id: true, date: true, reference: true } } },
      },
    },
  });
  if (!invoice) notFound();

  // Only a draft can be edited, so the pickers are only needed then.
  const editable = invoice.status === "DRAFT";
  const [customers, products] = editable
    ? await Promise.all([
        prisma.contact.findMany({
          where: { isArchived: false, type: { in: ["CUSTOMER", "BOTH"] } },
          orderBy: { name: "asc" },
        }),
        prisma.productService.findMany({ where: { isArchived: false }, orderBy: { code: "asc" } }),
      ])
    : [[], []];

  const bankAccounts = invoice.status === "DRAFT" || invoice.status === "VOID" ? [] : await bankAccountOptions();

  // Only matters while there is something to approve.
  const bankChangeNotice = invoice.status === "DRAFT" ? await loadBankChangeNotice(prisma) : null;

  return (
    <InvoiceDetailClient
      bankChangeNotice={bankChangeNotice}
      invoice={serializeInvoice(invoice)}
      bankAccounts={bankAccounts}
      customers={customers.map((c) => ({
        id: c.id,
        name: c.name,
        paymentTermsDays: c.paymentTermsDays,
        billingAddress: c.billingAddress,
        shippingAddress: c.shippingAddress,
        taxId: c.taxId,
      }))}
      products={products.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        unit: p.unit,
        unitPrice: toPence(p.unitPrice),
        incomeAccountId: p.incomeAccountId,
      }))}
      canEdit={hasPermission(session, "books:post")}
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
