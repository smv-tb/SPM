"use client";

import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  InvoiceForm,
  type CreditedInvoice,
  type ExistingInvoice,
  type InvoiceCustomer,
  type InvoiceProduct,
} from "@/components/books/InvoiceForm";
import { Users } from "lucide-react";

interface Props {
  customers: InvoiceCustomer[];
  products: InvoiceProduct[];
  creditFor: CreditedInvoice | null;
  initialLines?: ExistingInvoice["lines"];
  canApprove: boolean;
}

export function NewCreditNoteClient({ customers, products, creditFor, initialLines, canApprove }: Props) {
  const router = useRouter();

  return (
    <>
      <Topbar
        title="New credit note"
        subtitle={
          creditFor
            ? `Correcting invoice ${creditFor.number} — saved as a draft until approved`
            : "Credit for a customer — saved as a draft until approved"
        }
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Credit notes", href: "/books/credit-notes" },
          { label: "New", href: "/books/credit-notes/new" },
        ]}
      />

      <main className="flex-1 overflow-auto p-6">
        <Card>
          <CardContent className="p-5">
            {customers.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No customers yet"
                description="A credit note is for a customer. Add one first."
                actionLabel="Add a customer"
                onAction={() => router.push("/books/contacts")}
              />
            ) : (
              <InvoiceForm
                document="creditNote"
                customers={customers}
                products={products}
                creditFor={creditFor}
                initialLines={initialLines}
                canApprove={canApprove}
                onSaved={(id) => router.push(`/books/credit-notes/${id}`)}
                onCancel={() =>
                  router.push(creditFor ? `/books/invoices/${creditFor.id}` : "/books/credit-notes")
                }
              />
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
