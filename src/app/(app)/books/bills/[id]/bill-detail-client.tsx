"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useRef, useState } from "react";
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
import { BILL_STATUS_LABEL, isEditable, type BillStatus } from "@/lib/accounting/bill";
import { MAX_ATTACHMENTS_PER_BILL, formatFileSize } from "@/lib/accounting/bill-attachment";
import { BillForm, type BillAccountOption, type BillSupplier } from "@/components/books/BillForm";
import type { SerializedBill } from "@/lib/accounting/serialize";
import { FileText, Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";

interface Props {
  bill: SerializedBill;
  suppliers: BillSupplier[];
  accounts: BillAccountOption[];
  canEdit: boolean;
  canApprove: boolean;
}

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  PART_PAID: "warning",
  PAID: "success",
  VOID: "danger",
};

/** "Line 2: Choose the account…" — so a refused approval says where to look. */
function describeRefusal(payload: { error?: string; problems?: { message: string; line?: number }[] }, status: number) {
  const problems = Array.isArray(payload.problems)
    ? payload.problems.map((p) => (p.line ? `Line ${p.line}: ${p.message}` : p.message))
    : [];
  return [payload.error ?? `Request failed (${status})`, ...problems].join(". ");
}

export function BillDetailClient({ bill, suppliers, accounts, canEdit, canApprove }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const status = bill.status as BillStatus;
  const draft = isEditable(status);
  const title = bill.supplierReference ?? (draft ? "Draft bill" : "Bill");
  const canAttach = canEdit && status !== "VOID" && bill.attachments.length < MAX_ATTACHMENTS_PER_BILL;

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    const res = await clientFetch(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(false);
    if (!res.ok) {
      setError(describeRefusal(await res.json().catch(() => ({})), res.status));
      return false;
    }
    router.refresh();
    return true;
  }

  async function upload(file: File) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    const res = await clientFetch(`/api/books/bills/${bill.id}/attachments`, { method: "POST", body: form });
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Could not attach the file (${res.status})`);
      return;
    }
    router.refresh();
  }

  async function removeAttachment(id: string, name: string) {
    if (!(await confirmDialog(`Remove ${name}?`))) return;
    setBusy(true);
    const res = await clientFetch(`/api/books/bills/${bill.id}/attachments/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError("Could not remove the attachment");
  }

  if (editing) {
    return (
      <>
        <Topbar
          title="Edit draft"
          subtitle={bill.supplierName}
          breadcrumbs={[
            { label: "Accounting", href: "/books" },
            { label: "Bills", href: "/books/bills" },
            { label: "Draft", href: `/books/bills/${bill.id}` },
          ]}
        />
        <main className="flex-1 overflow-auto p-4 lg:p-8">
          <Card>
            <CardContent className="p-5">
              <BillForm
                suppliers={suppliers}
                accounts={accounts}
                canApprove={canApprove}
                bill={{
                  id: bill.id,
                  contactId: bill.contactId,
                  supplierReference: bill.supplierReference,
                  issueDate: bill.issueDate,
                  dueDate: bill.dueDate,
                  notes: bill.notes,
                  lines: bill.lines ?? [],
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
        title={title}
        subtitle={bill.supplierName}
        breadcrumbs={[
          { label: "Accounting", href: "/books" },
          { label: "Bills", href: "/books/bills" },
          { label: title },
        ]}
        actions={
          <div className="flex gap-2">
            {draft && canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {draft && canApprove && (
              <Button size="sm" disabled={busy} onClick={() => act(`/api/books/bills/${bill.id}/approve`)}>
                Approve
              </Button>
            )}
          </div>
        }
      />

      <main className="flex-1 overflow-auto p-4 lg:p-8 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_VARIANT[status] ?? "neutral"}>{BILL_STATUS_LABEL[status] ?? status}</Badge>
          {bill.journalNumber !== null && (
            <span className="text-sm text-muted-foreground">
              Posted as{" "}
              <Link href={`/books/journals/${bill.journalEntryId}`} className="text-primary hover:underline">
                journal #{bill.journalNumber}
              </Link>
            </span>
          )}
        </div>

        {error && !voiding && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Lines</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-semibold">Description</th>
                    <th className="px-3 py-2 text-left font-semibold">Account</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                    <th className="px-5 py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(bill.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td className="px-5 py-3 font-medium">{line.description}</td>
                      <td className="px-3 py-3">
                        {line.accountCode ? (
                          `${line.accountCode} ${line.accountName}`
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">Not chosen yet</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPence(line.unitPrice)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatPence(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border">
                  <tr>
                    <td className="px-5 py-3 font-semibold" colSpan={4}>
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatPence(bill.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">From</p>
                  <p className="font-medium">{bill.supplierName}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Their invoice number</p>
                  <p>{bill.supplierReference ?? "—"}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Dated</p>
                    <p>{formatDate(bill.issueDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Due</p>
                    <p>{formatDate(bill.dueDate)}</p>
                  </div>
                </div>
                {bill.notes && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Notes</p>
                    <p className="whitespace-pre-line">{bill.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Supplier&apos;s document</CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-3 text-sm">
                {bill.attachments.length === 0 ? (
                  <p className="text-muted-foreground">Nothing attached yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {bill.attachments.map((a) => {
                      const Icon = a.contentType === "application/pdf" ? FileText : ImageIcon;
                      return (
                        <li key={a.id} className="flex items-center gap-2">
                          <Icon className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                          <a
                            href={`/api/books/bills/${bill.id}/attachments/${a.id}`}
                            className="min-w-0 truncate text-primary hover:underline"
                            download={a.fileName}
                          >
                            {a.fileName}
                          </a>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(a.size)}</span>
                          {draft && canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto"
                              aria-label={`Remove ${a.fileName}`}
                              disabled={busy}
                              onClick={() => removeAttachment(a.id, a.fileName)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {canAttach && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(file);
                      }}
                    />
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                      <Paperclip className="w-3.5 h-3.5" aria-hidden /> Attach PDF or photo
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Up to 5 MB.{" "}
                      {draft
                        ? "Once the bill is approved, its attachments are kept as evidence and cannot be removed."
                        : "Kept as evidence: it cannot be removed later."}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {draft && canEdit && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (!(await confirmDialog("Delete this draft and its attachments?"))) return;
                setBusy(true);
                const res = await clientFetch(`/api/books/bills/${bill.id}`, { method: "DELETE" });
                setBusy(false);
                if (res.ok) router.push("/books/bills");
                else setError("Could not delete this draft");
              }}
            >
              Delete draft
            </Button>
          )}
          {canApprove && status === "APPROVED" && (
            <Button variant="ghost" disabled={busy} onClick={() => setVoiding(true)}>
              Void
            </Button>
          )}
        </div>

        {!draft && status !== "VOID" && (
          <p className="text-sm text-muted-foreground">
            An approved bill cannot be edited — void it and enter it again, so the books keep both the purchase and its
            cancellation.
          </p>
        )}
      </main>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this bill?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The posted journal is reversed today, not deleted, and the supplier&apos;s reference becomes free to enter
              again.
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
                if (await act(`/api/books/bills/${bill.id}/void`, { reason })) setVoiding(false);
              }}
            >
              Void bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
