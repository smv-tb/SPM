"use client";

import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { BillForm, type BillAccountOption, type BillSupplier } from "@/components/books/BillForm";
import { Users } from "lucide-react";

interface Props {
  suppliers: BillSupplier[];
  accounts: BillAccountOption[];
  canApprove: boolean;
}

export function NewBillClient({ suppliers, accounts, canApprove }: Props) {
  const router = useRouter();

  return (
    <>
      <Topbar
        title="New bill"
        subtitle="Saved as a draft until it is approved"
        breadcrumbs={[
          { label: "Accounting", href: "/books" },
          { label: "Bills", href: "/books/bills" },
          { label: "New" },
        ]}
      />

      <main className="flex-1 overflow-auto p-4 lg:p-8">
        <Card>
          <CardContent className="p-5">
            {suppliers.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No suppliers yet"
                description="A bill comes from a supplier. Add one as a contact of type Supplier (or Both) first."
                actionLabel="Add a supplier"
                onAction={() => router.push("/books/contacts")}
              />
            ) : (
              <BillForm
                suppliers={suppliers}
                accounts={accounts}
                canApprove={canApprove}
                onSaved={(id) => router.push(`/books/bills/${id}`)}
                onCancel={() => router.push("/books/bills")}
              />
            )}
          </CardContent>
        </Card>
        <p className="mt-3 text-sm text-muted-foreground">
          Save it first, then attach the supplier&apos;s PDF or a photo of it on the next screen.
        </p>
      </main>
    </>
  );
}
