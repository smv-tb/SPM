"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { BankAccountOption } from "@/lib/accounting/bank-accounts";
import { RecordPaymentDialog } from "@/components/books/PaymentDialogs";
import { HandCoins, Plus } from "lucide-react";

interface Props {
  payments: {
    id: string;
    status: string;
    contactName: string | null;
    date: string;
    amount: number;
    reference: string | null;
    remaining: number;
  }[];
  total: number;
  page: number;
  pageSize: number;
  suppliers: { id: string; name: string }[];
  bankAccounts: BankAccountOption[];
  canEdit: boolean;
}

export function SupplierPaymentsClient({ payments, total, page, pageSize, suppliers, bankAccounts, canEdit }: Props) {
  const router = useRouter();
  const [recording, setRecording] = useState(false);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const go = (next: number) => router.push(`/books/supplier-payments?page=${next}`);

  return (
    <>
      <Topbar
        title="Bill payments"
        subtitle="Money paid to suppliers"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Bill payments", href: "/books/supplier-payments" },
        ]}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setRecording(true)}>
              <Plus className="w-3.5 h-3.5" /> Record payment
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        {total > 0 && (
          <p className="text-sm text-muted-foreground">
            {from}–{to} of {total}
          </p>
        )}

        <Card>
          <CardContent className="px-0 py-0">
            {payments.length === 0 ? (
              <EmptyState
                icon={HandCoins}
                title="No supplier payments yet"
                description="Record a payment from a bill when the money has gone, or here for a payment on account."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left font-semibold">Date</th>
                    <th className="px-3 py-3 text-left font-semibold">Supplier</th>
                    <th className="px-3 py-3 text-left font-semibold">Reference</th>
                    <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <Link href={`/books/supplier-payments/${p.id}`} className="font-medium hover:text-primary">
                          {formatDate(p.date)}
                        </Link>
                        {p.status === "VOID" && (
                          <Badge variant="danger" size="sm" className="ml-2">
                            Void
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3">{p.contactName}</td>
                      <td className="px-3 py-3 text-muted-foreground">{p.reference ?? "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatPence(p.amount)}
                        {p.remaining > 0 && (
                          <span className="block text-xs text-amber-600">{formatPence(p.remaining)} on account</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {lastPage > 1 && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => go(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </main>

      {canEdit && (
        <RecordPaymentDialog
          open={recording}
          onOpenChange={setRecording}
          side="out"
          bankAccounts={bankAccounts}
          customers={suppliers}
          onRecorded={(id) => router.push(`/books/supplier-payments/${id}`)}
        />
      )}
    </>
  );
}
