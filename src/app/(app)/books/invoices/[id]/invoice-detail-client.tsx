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
import { FormLabel } from "@/components/ui/form-label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { calendarDateKey } from "@/lib/accounting/dates";
import { describePaymentTerms } from "@/lib/accounting/sales";
import { INVOICE_STATUS_LABEL, isEditable, type InvoiceStatus } from "@/lib/accounting/invoice";
import {
  InvoiceForm,
  type InvoiceCustomer,
  type InvoiceProduct,
} from "@/components/books/InvoiceForm";
import type { SerializedInvoice } from "@/lib/accounting/serialize";
import type { BankAccountOption } from "@/lib/accounting/bank-accounts";
import { RecordPaymentDialog } from "@/components/books/PaymentDialogs";
import { BANK_CHANGE_NOTICE_APPROVALS, type BankChangeNotice } from "@/lib/accounting/bank-details-change";

interface Props {
  invoice: SerializedInvoice;
  bankAccounts: BankAccountOption[];
  customers: InvoiceCustomer[];
  products: InvoiceProduct[];
  canEdit: boolean;
  canApprove: boolean;
  /** Set while the payee details changed recently and fewer than three invoices have been approved since. */
  bankChangeNotice: BankChangeNotice | null;
}

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  SENT: "warning",
  PART_PAID: "warning",
  PAID: "success",
  VOID: "danger",
};

export function InvoiceDetailClient({
  invoice,
  bankAccounts,
  customers,
  products,
  canEdit,
  canApprove,
  bankChangeNotice,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const status = invoice.status as InvoiceStatus;
  const draft = isEditable(status);
  const live = status !== "DRAFT" && status !== "VOID";
  const settled = invoice.credited + invoice.paid;

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
          title="Edit draft"
          subtitle={invoice.billToName}
          breadcrumbs={[
            { label: "Books", href: "/books" },
            { label: "Invoices", href: "/books/invoices" },
            { label: "Draft", href: `/books/invoices/${invoice.id}` },
          ]}
        />
        <main className="flex-1 overflow-auto p-6">
          <Card>
            <CardContent className="p-5">
              <InvoiceForm
                customers={customers}
                products={products}
                canApprove={canApprove}
                invoice={{
                  id: invoice.id,
                  contactId: invoice.contactId,
                  issueDate: invoice.issueDate,
                  paymentTermsDays: invoice.paymentTermsDays,
                  reference: invoice.reference,
                  notes: invoice.notes,
                  lines: invoice.lines ?? [],
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
        title={invoice.number ?? "Draft invoice"}
        subtitle={invoice.billToName}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Invoices", href: "/books/invoices" },
          { label: invoice.number ?? "Draft", href: `/books/invoices/${invoice.id}` },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              {/* Opens in the browser's viewer; saving it keeps the
                  Invoice-INVnnn.pdf name that goes out by email. */}
              <a href={`/api/books/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
                PDF
              </a>
            </Button>
            {draft && canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {draft && canApprove && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => act(`/api/books/invoices/${invoice.id}/approve`)}
              >
                Approve
              </Button>
            )}
            {live && canEdit && invoice.amountDue > 0 && (
              <Button size="sm" onClick={() => setPaying(true)}>
                Record payment
              </Button>
            )}
            {live && canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/books/credit-notes/new?invoice=${invoice.id}`)}
              >
                Credit note
              </Button>
            )}
            {live && !invoice.sentAt && canEdit && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  act(`/api/books/invoices/${invoice.id}/send`, { sentAt: calendarDateKey() })
                }
              >
                Mark sent
              </Button>
            )}
          </div>
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_VARIANT[status] ?? "neutral"}>
            {INVOICE_STATUS_LABEL[status] ?? status}
          </Badge>
          {invoice.isImported && <Badge variant="neutral">Imported</Badge>}
          {invoice.journalNumber !== null && (
            <span className="text-sm text-muted-foreground">
              Posted as{" "}
              <Link
                href={`/books/journals/${invoice.journalEntryId}`}
                className="text-primary hover:underline"
              >
                journal #{invoice.journalNumber}
              </Link>
            </span>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {draft && canApprove && bankChangeNotice && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Bank details changed on {formatDate(bankChangeNotice.changedAt)}</strong>
            {bankChangeNotice.changedBy ? ` by ${bankChangeNotice.changedBy}` : ""}. Before approving, check that
            the details printed on this invoice are the ones you expect — swapping them is how invoice fraud works.
            This reminder shows on the next {BANK_CHANGE_NOTICE_APPROVALS} invoices approved.
          </div>
        )}

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
                  {(invoice.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td className="px-5 py-3">
                        <span className="font-medium">
                          {line.code ? `${line.code} ` : ""}
                          {line.name}
                        </span>
                        {line.description && (
                          <span className="block text-xs text-muted-foreground">
                            {line.description}
                          </span>
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
                    <td className="px-5 py-2 text-muted-foreground" colSpan={3}>
                      Subtotal
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums">
                      {formatPence(invoice.subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 font-semibold" colSpan={3}>
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatPence(invoice.total)}
                    </td>
                  </tr>
                  {invoice.credits.map((credit) => (
                    <tr key={credit.id ?? credit.creditNoteId}>
                      <td className="px-5 py-2 text-muted-foreground" colSpan={3}>
                        Less credit note{" "}
                        <Link
                          href={`/books/credit-notes/${credit.creditNoteId}`}
                          className="text-primary hover:underline"
                        >
                          {credit.creditNoteNumber}
                        </Link>
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums">
                        -{formatPence(credit.amount)}
                      </td>
                    </tr>
                  ))}
                  {invoice.payments.map((payment) => (
                    <tr key={payment.id ?? payment.paymentId}>
                      <td className="px-5 py-2 text-muted-foreground" colSpan={3}>
                        Less{" "}
                        <Link
                          href={`/books/payments/${payment.paymentId}`}
                          className="text-primary hover:underline"
                        >
                          payment received {payment.paymentDate ? formatDate(payment.paymentDate) : ""}
                        </Link>
                        {payment.reference && <span> ({payment.reference})</span>}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums">
                        -{formatPence(payment.amount)}
                      </td>
                    </tr>
                  ))}
                  {live && settled > 0 && (
                    <tr className="border-t border-border">
                      <td className="px-5 py-3 font-semibold" colSpan={3}>
                        Amount due
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatPence(invoice.amountDue)}
                      </td>
                    </tr>
                  )}
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
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Billed to</p>
                <p className="font-medium">{invoice.billToName}</p>
                {invoice.billToAddress && (
                  <p className="whitespace-pre-line text-muted-foreground">{invoice.billToAddress}</p>
                )}
                {invoice.taxId && (
                  <p className="text-xs text-muted-foreground">Taxpayer ID {invoice.taxId}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Issued</p>
                  <p>{formatDate(invoice.issueDate)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Due</p>
                  <p>{formatDate(invoice.dueDate)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Terms</p>
                <p>{describePaymentTerms(invoice.paymentTermsDays)}</p>
              </div>
              {invoice.sentAt && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Sent</p>
                  <p>{formatDate(invoice.sentAt.slice(0, 10))}</p>
                </div>
              )}
              {invoice.reference && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Reference</p>
                  <p>{invoice.reference}</p>
                </div>
              )}
              {invoice.notes && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-line">{invoice.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {draft && canEdit && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (!await confirmDialog("Delete this draft?")) return;
                setBusy(true);
                const res = await clientFetch(`/api/books/invoices/${invoice.id}`, {
                  method: "DELETE",
                });
                setBusy(false);
                if (res.ok) router.push("/books/invoices");
                else setError("Could not delete this draft");
              }}
            >
              Delete draft
            </Button>
          )}
          {/* A credited invoice is already partly reversed: voiding it too
              would credit the customer twice, so the credit goes first. */}
          {canApprove && status !== "VOID" && status !== "PAID" && settled === 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => setVoiding(true)}>
              Void
            </Button>
          )}
        </div>

        {status !== "DRAFT" && status !== "VOID" && (
          <p className="text-sm text-muted-foreground">
            An approved invoice cannot be edited — correct it with a credit note or void it, so the
            books keep both the sale and its cancellation.
            {settled > 0 &&
              " It has credit or payments applied, so it can no longer be voided: credit what is unpaid instead, or void those first."}
          </p>
        )}
      </main>

      {live && (
        <RecordPaymentDialog
          open={paying}
          onOpenChange={setPaying}
          bankAccounts={bankAccounts}
          invoice={{
            id: invoice.id,
            number: invoice.number,
            contactId: invoice.contactId,
            amountDue: invoice.amountDue,
          }}
          onRecorded={() => router.refresh()}
        />
      )}

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {invoice.number ?? "this draft"}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {invoice.journalNumber !== null
                ? "The posted journal is reversed, not deleted, and the number stays used."
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
                if (await act(`/api/books/invoices/${invoice.id}/void`, { reason })) {
                  setVoiding(false);
                }
              }}
            >
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
