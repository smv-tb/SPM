"use client";

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
import {
  CREDIT_NOTE_STATUSES,
  CREDIT_NOTE_STATUS_LABEL,
  type CreditNoteStatus,
} from "@/lib/accounting/credit-note";
import { Plus, Undo2 } from "lucide-react";

export interface CreditNoteListRow {
  id: string;
  number: string | null;
  status: string;
  billToName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  issueDate: string;
  reference: string | null;
  total: number;
  remaining: number;
}

interface Props {
  creditNotes: CreditNoteListRow[];
  total: number;
  page: number;
  pageSize: number;
  status: CreditNoteStatus | null;
  canEdit: boolean;
}

export const CREDIT_NOTE_STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  APPROVED: "success",
  VOID: "danger",
};

export function CreditNotesClient({ creditNotes, total, page, pageSize, status, canEdit }: Props) {
  const router = useRouter();
  const search = useSearchParams();

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function go(next: { status?: string | null; page?: number }) {
    const params = new URLSearchParams(search.toString());
    if (next.status !== undefined) {
      if (next.status) params.set("status", next.status);
      else params.delete("status");
      params.delete("page");
    }
    if (next.page !== undefined) params.set("page", String(next.page));
    router.push(`/books/credit-notes${params.size > 0 ? `?${params}` : ""}`);
  }

  return (
    <>
      <Topbar
        title="Credit notes"
        subtitle="Corrections to invoices, and credit owed to customers"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Credit notes", href: "/books/credit-notes" },
        ]}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => router.push("/books/credit-notes/new")}>
              <Plus className="w-3.5 h-3.5" /> New credit note
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            aria-label="Status"
            className="w-48"
            value={status ?? ""}
            onChange={(e) => go({ status: e.target.value || null })}
          >
            <option value="">All credit notes</option>
            {CREDIT_NOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CREDIT_NOTE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">
              {from}–{to} of {total}
            </span>
          )}
        </div>

        <Card>
          <CardContent className="px-0 py-0">
            {creditNotes.length === 0 ? (
              <EmptyState
                icon={Undo2}
                title="No credit notes"
                description="To correct an approved invoice, open it and choose Credit note."
                actionLabel={canEdit ? "Go to invoices" : undefined}
                onAction={canEdit ? () => router.push("/books/invoices") : undefined}
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left font-semibold">Number</th>
                    <th className="px-3 py-3 text-left font-semibold">Customer</th>
                    <th className="px-3 py-3 text-left font-semibold">Against</th>
                    <th className="px-3 py-3 text-left font-semibold">Issued</th>
                    <th className="px-3 py-3 text-left font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {creditNotes.map((note) => (
                    <tr key={note.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <Link
                          href={`/books/credit-notes/${note.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {note.number ?? "Draft"}
                        </Link>
                        {note.reference && (
                          <span className="block text-xs text-muted-foreground">{note.reference}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">{note.billToName}</td>
                      <td className="px-3 py-3">
                        {note.invoiceId ? (
                          <Link href={`/books/invoices/${note.invoiceId}`} className="hover:text-primary">
                            {note.invoiceNumber}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDate(note.issueDate)}</td>
                      <td className="px-3 py-3">
                        <Badge variant={CREDIT_NOTE_STATUS_VARIANT[note.status] ?? "neutral"} size="sm">
                          {CREDIT_NOTE_STATUS_LABEL[note.status as CreditNoteStatus] ?? note.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatPence(note.total)}
                        {note.remaining > 0 && (
                          <span className="block text-xs text-amber-600">
                            {formatPence(note.remaining)} unallocated
                          </span>
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
            <Button
              variant="outline"
              size="sm"
              disabled={page >= lastPage}
              onClick={() => go({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
