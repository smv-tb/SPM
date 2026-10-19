"use client";

import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  InvoiceForm,
  type InvoiceCustomer,
  type InvoiceProduct,
} from "@/components/books/InvoiceForm";
import { Users } from "lucide-react";

interface Props {
  customers: InvoiceCustomer[];
  products: InvoiceProduct[];
  canApprove: boolean;
}

export function NewInvoiceClient({ customers, products, canApprove }: Props) {
  const router = useRouter();

  return (
    <>
      <Topbar
        title="New invoice"
        subtitle="Saved as a draft until it is approved"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Invoices", href: "/books/invoices" },
          { label: "New", href: "/books/invoices/new" },
        ]}
      />

      <main className="flex-1 overflow-auto p-6">
        <Card>
          <CardContent className="p-5">
            {customers.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No customers yet"
                description="An invoice needs someone to bill. Add a customer first."
                actionLabel="Add a customer"
                onAction={() => router.push("/books/contacts")}
              />
            ) : (
              <InvoiceForm
                customers={customers}
                products={products}
                canApprove={canApprove}
                onSaved={(id) => router.push(`/books/invoices/${id}`)}
                onCancel={() => router.push("/books/invoices")}
              />
            )}
          </CardContent>
        </Card>

        {products.length === 0 && customers.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            No catalogue items yet — lines can still be typed in by hand, or{" "}
            <Button variant="ghost" size="sm" onClick={() => router.push("/books/products")}>
              add products and services
            </Button>
            .
          </p>
        )}
      </main>
    </>
  );
}
