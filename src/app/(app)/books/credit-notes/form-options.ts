import { prisma } from "@/lib/prisma";
import { toPence } from "@/lib/money";
import type { InvoiceCustomer, InvoiceProduct } from "@/components/books/InvoiceForm";

/**
 * The pickers a credit note form needs. The credited customer is always
 * included, archived or not: a correction is still owed to someone who has
 * since been archived.
 */
export async function creditNoteFormOptions(
  customerId?: string | null
): Promise<{ customers: InvoiceCustomer[]; products: InvoiceProduct[] }> {
  const [customers, products] = await Promise.all([
    prisma.contact.findMany({
      where: {
        OR: [
          { isArchived: false, type: { in: ["CUSTOMER", "BOTH"] } },
          ...(customerId ? [{ id: customerId }] : []),
        ],
      },
      orderBy: { name: "asc" },
    }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { code: "asc" } }),
  ]);

  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      paymentTermsDays: c.paymentTermsDays,
      billingAddress: c.billingAddress,
      shippingAddress: c.shippingAddress,
      taxId: c.taxId,
    })),
    products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      unit: p.unit,
      unitPrice: toPence(p.unitPrice),
      incomeAccountId: p.incomeAccountId,
    })),
  };
}
