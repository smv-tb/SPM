"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select-native";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PAYMENT_KIND_LABEL, type PaymentKind } from "@/lib/accounting/payment";
import type { BankAccountOption } from "@/lib/accounting/bank-accounts";
import { RecordPaymentDialog } from "@/components/books/PaymentDialogs";
import { Banknote, Plus } from "lucide-react";

export interface PaymentListRow {
  id: string;
  kind: string;
  status: string;
  contactName: string | null;
  date: string;
  amount: number;
  reference: string | null;
  remaining: number;
}

interface Props {
  payments: PaymentListRow[];
  total: number;
  page: number;
  pageSize: number;
  kind: PaymentKind | null;
  customers: { id: string; name: string }[];
  bankAccounts: BankAccountOption[];
  canEdit: boolean;
}

export function PaymentsClient({ payments, total, page, pageSize, kind, customers, bankAccounts, canEdit }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [recording, setRecording] = useState(false);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function go(next: { kind?: string | null; page?: number }) {
    const params = new URLSearchParams(search.toString());
    if (next.kind !== undefined) {
      if (next.kind) params.set("kind", next.kind);
      else params.delete("kind");
      params.delete("page");
    }
    if (next.page !== undefined) params.set("page", String(next.page));
    router.push(`/books/payments${params.size > 0 ? `?${params}` : ""}`);
  }

  return (
    <>
      <Topbar
        title="Payments"
        subtitle="Money received from customers, and refunds paid back"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Payments", href: "/books/payments" },
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
        <div className="flex flex-wrap items-center gap-3">
          <Select aria-label="Kind" className="w-56" value={kind ?? ""} onChange={(e) => go({ kind: e.target.value || null })}>
            <option value="">Payments and refunds</option>
            <option value="RECEIPT">{PAYMENT_KIND_LABEL.RECEIPT}</option>
            <option value="REFUND">{PAYMENT_KIND_LABEL.REFUND}</option>
          </Select>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">
              {from}–{to} of {total}
            </span>
          )}
        </div>

        <Card>
          <CardContent className="px-0 py-0">
            {payments.length === 0 ? (
              <EmptyState
                icon={Banknote}
                title="No payments yet"
                description="Record a payment from an invoice when the money arrives, or here for a payment on account."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left font-semibold">Date</th>
                    <th className="px-3 py-3 text-left font-semibold">Customer</th>
                    <th className="px-3 py-3 text-left font-semibold">Kind</th>
                    <th className="px-3 py-3 text-left font-semibold">Reference</th>
                    <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <Link href={`/books/payments/${p.id}`} className="font-medium hover:text-primary">
                          {formatDate(p.date)}
                        </Link>
                      </td>
                      <td className="px-3 py-3">{p.contactName}</td>
                      <td className="px-3 py-3">
                        {PAYMENT_KIND_LABEL[p.kind as PaymentKind] ?? p.kind}
                        {p.status === "VOID" && (
                          <Badge variant="danger" size="sm" className="ml-2">
                            Void
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{p.reference ?? "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {p.kind === "REFUND" ? "-" : ""}
                        {formatPence(p.amount)}
                        {p.remaining > 0 && (
                          <span className="block text-xs text-amber-600">{formatPence(p.remaining)} unallocated</span>
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
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => go({ page: page + 1 })}>
              Next
            </Button>
          </div>
        )}
      </main>

      {canEdit && (
        <RecordPaymentDialog
          open={recording}
          onOpenChange={setRecording}
          bankAccounts={bankAccounts}
          customers={customers}
          onRecorded={(id) => router.push(`/books/payments/${id}`)}
        />
      )}
    </>
  );
}
