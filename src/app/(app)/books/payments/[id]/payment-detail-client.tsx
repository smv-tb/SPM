"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence, fromPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PAYMENT_KIND_LABEL, type PaymentKind } from "@/lib/accounting/payment";
import type { SerializedPayment } from "@/lib/accounting/serialize";
import type { BankAccountOption } from "@/lib/accounting/bank-accounts";
import { RefundDialog } from "@/components/books/PaymentDialogs";

interface Props {
  payment: SerializedPayment;
  openInvoices: { id: string; number: string | null; amountDue: number }[];
  bankAccounts: BankAccountOption[];
  canEdit: boolean;
  canApprove: boolean;
}

export function PaymentDetailClient({ payment, openInvoices, bankAccounts, canEdit, canApprove }: Props) {
  const router = useRouter();
  const [allocating, setAllocating] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [target, setTarget] = useState(openInvoices[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = `/api/books/payments/${payment.id}`;
  const receipt = payment.kind === "RECEIPT";
  const live = payment.status === "POSTED";
  const label = PAYMENT_KIND_LABEL[payment.kind as PaymentKind] ?? payment.kind;
  const targetInvoice = openInvoices.find((i) => i.id === target) ?? null;

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    const res = await clientFetch(path, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Request failed (${res.status})`);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <Topbar
        title={`${label} ${formatPence(payment.amount)}`}
        subtitle={`${payment.contactName} — ${formatDate(payment.date)}`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Payments", href: "/books/payments" },
          { label: formatDate(payment.date), href: `/books/payments/${payment.id}` },
        ]}
        actions={
          <div className="flex gap-2">
            {live && payment.remaining > 0 && openInvoices.length > 0 && canEdit && (
              <Button size="sm" disabled={busy} onClick={() => setAllocating(true)}>
                Allocate
              </Button>
            )}
            {live && payment.remaining > 0 && canApprove && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setRefunding(true)}>
                Refund
              </Button>
            )}
          </div>
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={live ? "success" : "danger"}>{live ? "Posted" : "Void"}</Badge>
          {payment.journalNumber !== null && (
            <span className="text-sm text-muted-foreground">
              Posted as{" "}
              <Link href={`/books/journals/${payment.journalEntryId}`} className="text-primary hover:underline">
                journal #{payment.journalNumber}
              </Link>
            </span>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{receipt ? "Where the money went" : "What it paid back"}</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 text-sm space-y-2">
              {!live && (
                <p className="text-muted-foreground">
                  {receipt
                    ? "Voiding released what it paid; those invoices are owed again."
                    : "Voiding released the credit it paid back; it can be used again."}
                </p>
              )}
              {receipt ? (
                payment.allocations.length === 0 ? (
                  <p className="text-muted-foreground">Not yet applied to any invoice.</p>
                ) : (
                  payment.allocations.map((a) => (
                    <div key={a.id} className={`flex justify-between ${a.releasedOn ? "text-muted-foreground line-through" : ""}`}>
                      <span>
                        {a.invoiceId ? (
                          <Link href={`/books/invoices/${a.invoiceId}`} className="text-primary hover:underline">
                            {a.invoiceNumber}
                          </Link>
                        ) : (
                          <Link href={`/books/payments/${a.refundId}`} className="text-primary hover:underline">
                            Refunded
                          </Link>
                        )}
                        {a.date && <span className="text-muted-foreground"> on {formatDate(a.date)}</span>}
                        {a.releasedOn && <span> — released {formatDate(a.releasedOn)}</span>}
                      </span>
                      <span className="tabular-nums">{formatPence(a.amount)}</span>
                    </div>
                  ))
                )
              ) : (
                payment.refundOf.map((s) => (
                  <div key={s.paymentId ?? s.creditNoteId} className="flex justify-between">
                    <Link
                      href={s.paymentId ? `/books/payments/${s.paymentId}` : `/books/credit-notes/${s.creditNoteId}`}
                      className="text-primary hover:underline"
                    >
                      {s.label}
                    </Link>
                    <span className="tabular-nums">{formatPence(s.amount)}</span>
                  </div>
                ))
              )}
              {payment.remaining > 0 && (
                <p className="pt-2 border-t border-border flex justify-between font-medium">
                  <span>Unallocated</span>
                  <span className="tabular-nums">{formatPence(payment.remaining)}</span>
                </p>
              )}
              {payment.remaining > 0 && openInvoices.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {payment.contactName} has no open invoices to apply it to: it stays as their credit
                  until one is raised, or it is refunded.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Customer</p>
                <p className="font-medium">{payment.contactName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Bank account</p>
                <p>
                  {payment.bankAccountCode} {payment.bankAccountName}
                </p>
              </div>
              {payment.reference && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Reference</p>
                  <p>{payment.reference}</p>
                </div>
              )}
              {payment.notes && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-line">{payment.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {live && canApprove && (
          <Button variant="ghost" disabled={busy} onClick={() => setVoiding(true)}>
            Void
          </Button>
        )}
      </main>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this {receipt ? "payment" : "refund"}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {receipt
                ? "Its journal is reversed and the invoices it paid are owed again. Use this for a payment recorded by mistake — not for one that bounced later, which needs its own entry."
                : "Its journal is reversed and the credit it paid back is available again."}
            </p>
            <div>
              <FormLabel htmlFor="void-reason">Reason</FormLabel>
              <Input id="void-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoiding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy || reason.trim().length === 0}
              onClick={async () => {
                if (await act(`${base}/void`, { reason })) setVoiding(false);
              }}
            >
              Void {receipt ? "payment" : "refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={allocating} onOpenChange={setAllocating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate this payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {formatPence(payment.remaining)} is unallocated. Applying it settles the invoice; nothing new
              is posted.
            </p>
            <div>
              <FormLabel htmlFor="allocate-invoice">Invoice</FormLabel>
              <Select id="allocate-invoice" value={target} onChange={(e) => setTarget(e.target.value)}>
                {openInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — {formatPence(i.amountDue)} due
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FormLabel htmlFor="allocate-amount">Amount</FormLabel>
              <Input
                id="allocate-amount"
                inputMode="decimal"
                placeholder={targetInvoice ? fromPence(Math.min(payment.remaining, targetInvoice.amountDue)) : "0.00"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Leave blank to apply as much as the invoice still owes.</p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAllocating(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy || !target}
              onClick={async () => {
                const body = { invoiceId: target, ...(amount.trim() ? { amount: amount.trim() } : {}) };
                if (await act(`${base}/allocate`, body)) {
                  setAllocating(false);
                  setAmount("");
                }
              }}
            >
              Allocate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {live && payment.remaining > 0 && (
        <RefundDialog
          open={refunding}
          onOpenChange={setRefunding}
          bankAccounts={bankAccounts}
          source={{ paymentId: payment.id }}
          remaining={payment.remaining}
          label="this payment"
          onRecorded={(id) => router.push(`/books/payments/${id}`)}
        />
      )}
    </>
  );
}
