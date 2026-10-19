"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

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
import { CREDIT_NOTE_STATUS_LABEL, type CreditNoteStatus } from "@/lib/accounting/credit-note";
import {
  InvoiceForm,
  type InvoiceCustomer,
  type InvoiceProduct,
} from "@/components/books/InvoiceForm";
import type { SerializedCreditNote } from "@/lib/accounting/serialize";
import { CREDIT_NOTE_STATUS_VARIANT } from "../credit-notes-client";
import type { BankAccountOption } from "@/lib/accounting/bank-accounts";
import { RefundDialog } from "@/components/books/PaymentDialogs";

interface OpenInvoice {
  id: string;
  number: string | null;
  amountDue: number;
}

interface Props {
  creditNote: SerializedCreditNote;
  customers: InvoiceCustomer[];
  products: InvoiceProduct[];
  /** The customer's invoices that unallocated credit could still settle. */
  openInvoices: OpenInvoice[];
  bankAccounts: BankAccountOption[];
  canEdit: boolean;
  canApprove: boolean;
}

export function CreditNoteDetailClient({
  creditNote: note,
  customers,
  products,
  openInvoices,
  bankAccounts,
  canEdit,
  canApprove,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState(openInvoices[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const status = note.status as CreditNoteStatus;
  const draft = status === "DRAFT";
  const base = `/api/books/credit-notes/${note.id}`;
  const targetInvoice = openInvoices.find((i) => i.id === target) ?? null;

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    const res = await clientFetch(path, {
      method: "POST",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Request failed (${res.status})`);
      return false;
    }
    router.refresh();
    return true;
  }

  if (editing) {
    return (
      <>
        <Topbar
          title="Edit draft credit note"
          subtitle={note.billToName}
          breadcrumbs={[
            { label: "Books", href: "/books" },
            { label: "Credit notes", href: "/books/credit-notes" },
            { label: "Draft", href: `/books/credit-notes/${note.id}` },
          ]}
        />
        <main className="flex-1 overflow-auto p-6">
          <Card>
            <CardContent className="p-5">
              <InvoiceForm
                document="creditNote"
                customers={customers}
                products={products}
                canApprove={canApprove}
                invoice={{
                  id: note.id,
                  contactId: note.contactId,
                  invoiceId: note.invoiceId,
                  issueDate: note.issueDate,
                  reference: note.reference,
                  notes: note.notes,
                  lines: note.lines ?? [],
                }}
                onSaved={() => {
                  setEditing(false);
                  router.refresh();
                }}
                onCancel={() => setEditing(false)}
              />
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={note.number ?? "Draft credit note"}
        subtitle={note.billToName}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Credit notes", href: "/books/credit-notes" },
          { label: note.number ?? "Draft", href: `/books/credit-notes/${note.id}` },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`${base}/pdf`} target="_blank" rel="noreferrer">
                PDF
              </a>
            </Button>
            {draft && canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {draft && canApprove && (
              <Button size="sm" disabled={busy} onClick={() => act(`${base}/approve`)}>
                Approve
              </Button>
            )}
            {note.remaining > 0 && openInvoices.length > 0 && canApprove && (
              <Button size="sm" disabled={busy} onClick={() => setAllocating(true)}>
                Allocate credit
              </Button>
            )}
            {note.remaining > 0 && canApprove && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setRefunding(true)}>
                Refund
              </Button>
            )}
          </div>
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={CREDIT_NOTE_STATUS_VARIANT[status] ?? "neutral"}>
            {CREDIT_NOTE_STATUS_LABEL[status] ?? status}
          </Badge>
          {note.invoiceId && (
            <span className="text-sm text-muted-foreground">
              Against{" "}
              <Link href={`/books/invoices/${note.invoiceId}`} className="text-primary hover:underline">
                invoice {note.invoiceNumber}
              </Link>
            </span>
          )}
          {note.journalNumber !== null && (
            <span className="text-sm text-muted-foreground">
              Posted as{" "}
              <Link href={`/books/journals/${note.journalEntryId}`} className="text-primary hover:underline">
                journal #{note.journalNumber}
              </Link>
            </span>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Lines</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-semibold">Item</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                    <th className="px-5 py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(note.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td className="px-5 py-3">
                        <span className="font-medium">
                          {line.code ? `${line.code} ` : ""}
                          {line.name}
                        </span>
                        {line.description && (
                          <span className="block text-xs text-muted-foreground">{line.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPence(line.unitPrice)}
                        <span className="text-muted-foreground"> /{line.unit}</span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatPence(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border">
                  <tr>
                    <td className="px-5 py-3 font-semibold" colSpan={3}>
                      Total credit
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatPence(note.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Credited to</p>
                <p className="font-medium">{note.billToName}</p>
                {note.billToAddress && (
                  <p className="whitespace-pre-line text-muted-foreground">{note.billToAddress}</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Issued</p>
                <p>{formatDate(note.issueDate)}</p>
              </div>
              {note.reference && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Reference</p>
                  <p>{note.reference}</p>
                </div>
              )}
              {note.notes && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-line">{note.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {status !== "DRAFT" && (
          <Card>
            <CardHeader>
              <CardTitle>Allocations</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 text-sm space-y-2">
              {status === "VOID" && note.allocations.length > 0 && (
                <p className="text-muted-foreground">
                  Voiding released these allocations; the invoices they settled are owed again.
                </p>
              )}
              {note.allocations.length === 0 ? (
                <p className="text-muted-foreground">
                  {status === "VOID" ? "It was never applied to an invoice." : "Not yet applied to any invoice."}
                </p>
              ) : (
                note.allocations.map((a) => (
                  <div key={a.id} className={`flex justify-between ${a.releasedOn ? "text-muted-foreground line-through" : ""}`}>
                    <span>
                      {a.invoiceId ? (
                        <Link href={`/books/invoices/${a.invoiceId}`} className="text-primary hover:underline">
                          {a.invoiceNumber}
                        </Link>
                      ) : (
                        <Link href={`/books/payments/${a.refundId}`} className="text-primary hover:underline">
                          Refunded to the customer
                        </Link>
                      )}
                      {a.date && <span className="text-muted-foreground"> on {formatDate(a.date)}</span>}
                      {a.releasedOn && <span className="no-underline"> — released {formatDate(a.releasedOn)}</span>}
                    </span>
                    <span className="tabular-nums">{formatPence(a.amount)}</span>
                  </div>
                ))
              )}
              {note.remaining > 0 && (
                <p className="pt-2 border-t border-border flex justify-between font-medium">
                  <span>Unallocated credit</span>
                  <span className="tabular-nums">{formatPence(note.remaining)}</span>
                </p>
              )}
              {note.remaining > 0 && openInvoices.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {note.billToName} has no open invoices to apply it to. It stays as credit until
                  one is raised, or it is refunded.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          {draft && canEdit && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (!await confirmDialog("Delete this draft?")) return;
                setBusy(true);
                const res = await clientFetch(base, { method: "DELETE" });
                setBusy(false);
                if (res.ok) router.push("/books/credit-notes");
                else setError("Could not delete this draft");
              }}
            >
              Delete draft
            </Button>
          )}
          {canApprove && status !== "VOID" && (
            <Button variant="ghost" disabled={busy} onClick={() => setVoiding(true)}>
              Void
            </Button>
          )}
        </div>
      </main>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {note.number ?? "this draft"}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {note.journalNumber !== null
                ? "The posted journal is reversed, not deleted, and the number stays used. Invoices this credit settled become owed again."
                : "The draft is marked void and keeps no number."}
            </p>
            <div>
              <FormLabel htmlFor="void-reason">Reason</FormLabel>
              <Input
                id="void-reason"
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
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
              Void credit note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {note.remaining > 0 && (
        <RefundDialog
          open={refunding}
          onOpenChange={setRefunding}
          bankAccounts={bankAccounts}
          source={{ creditNoteId: note.id }}
          remaining={note.remaining}
          label={`credit note ${note.number}`}
          onRecorded={(id) => router.push(`/books/payments/${id}`)}
        />
      )}

      <Dialog open={allocating} onOpenChange={setAllocating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate credit from {note.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {formatPence(note.remaining)} of this credit is unallocated. Applying it reduces
              what the customer owes on the invoice; nothing new is posted.
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
                placeholder={
                  targetInvoice ? fromPence(Math.min(note.remaining, targetInvoice.amountDue)) : "0.00"
                }
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave blank to apply as much as the invoice still owes.
              </p>
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
    </>
  );
}
