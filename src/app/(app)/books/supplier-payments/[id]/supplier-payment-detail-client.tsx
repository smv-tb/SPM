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
import type { SerializedSupplierPayment } from "@/lib/accounting/serialize";

interface Props {
  payment: SerializedSupplierPayment;
  openBills: { id: string; label: string; amountDue: number }[];
  canEdit: boolean;
  canApprove: boolean;
}

export function SupplierPaymentDetailClient({ payment, openBills, canEdit, canApprove }: Props) {
  const router = useRouter();
  const [allocating, setAllocating] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [target, setTarget] = useState(openBills[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = `/api/books/supplier-payments/${payment.id}`;
  const live = payment.status === "POSTED";
  const targetBill = openBills.find((b) => b.id === target) ?? null;

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
        title={`Payment ${formatPence(payment.amount)}`}
        subtitle={`${payment.contactName} — ${formatDate(payment.date)}`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Bill payments", href: "/books/supplier-payments" },
          { label: formatDate(payment.date), href: `/books/supplier-payments/${payment.id}` },
        ]}
        actions={
          live && payment.remaining > 0 && openBills.length > 0 && canEdit ? (
            <Button size="sm" disabled={busy} onClick={() => setAllocating(true)}>
              Allocate
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={live ? "success" : "danger"}>{live ? "Posted" : "Void"}</Badge>
          <span className="text-sm text-muted-foreground">
            Posted as{" "}
            <Link href={`/books/journals/${payment.journalEntryId}`} className="text-primary hover:underline">
              journal #{payment.journalNumber}
            </Link>
          </span>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Bills it paid</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 text-sm space-y-2">
              {!live && (
                <p className="text-muted-foreground">Voiding released what it paid; those bills are owed again.</p>
              )}
              {payment.allocations.length === 0 ? (
                <p className="text-muted-foreground">Not yet applied to any bill.</p>
              ) : (
                payment.allocations.map((a) => (
                  <div key={a.id} className={`flex justify-between ${a.releasedOn ? "text-muted-foreground line-through" : ""}`}>
                    <span>
                      <Link href={`/books/bills/${a.billId}`} className="text-primary hover:underline">
                        {a.billReference ?? "Bill"}
                      </Link>
                      {a.date && <span className="text-muted-foreground"> on {formatDate(a.date)}</span>}
                      {a.releasedOn && <span> — released {formatDate(a.releasedOn)}</span>}
                    </span>
                    <span className="tabular-nums">{formatPence(a.amount)}</span>
                  </div>
                ))
              )}
              {payment.remaining > 0 && (
                <p className="pt-2 border-t border-border flex justify-between font-medium">
                  <span>Paid on account</span>
                  <span className="tabular-nums">{formatPence(payment.remaining)}</span>
                </p>
              )}
              {payment.remaining > 0 && openBills.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {payment.contactName} has no open bills to apply it to: it stays on account until their next bill
                  is entered.
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
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Supplier</p>
                <p className="font-medium">{payment.contactName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Paid from</p>
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
            <DialogTitle>Void this payment?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Its journal is reversed and the bills it paid are owed again. Use this for a payment recorded by
              mistake. If the bank has already matched it, unmatch it on the reconcile screen first.
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
              Void payment
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
              {formatPence(payment.remaining)} is paid on account. Applying it settles the bill; nothing new is
              posted.
            </p>
            <div>
              <FormLabel htmlFor="allocate-bill">Bill</FormLabel>
              <Select id="allocate-bill" value={target} onChange={(e) => setTarget(e.target.value)}>
                {openBills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} — {formatPence(b.amountDue)} due
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FormLabel htmlFor="allocate-amount">Amount</FormLabel>
              <Input
                id="allocate-amount"
                inputMode="decimal"
                placeholder={targetBill ? fromPence(Math.min(payment.remaining, targetBill.amountDue)) : "0.00"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Leave blank to apply as much as the bill still owes.</p>
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
                const body = { billId: target, ...(amount.trim() ? { amount: amount.trim() } : {}) };
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
    </>
  );
}
