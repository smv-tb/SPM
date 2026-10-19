export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { NewInvoiceClient } from "./new-invoice-client";

export default async function NewInvoicePage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:post")) redirect("/books");

  const [customers, products] = await Promise.all([
    prisma.contact.findMany({
      where: { isArchived: false, type: { in: ["CUSTOMER", "BOTH"] } },
      orderBy: { name: "asc" },
    }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { code: "asc" } }),
  ]);

  return (
    <NewInvoiceClient
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
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
