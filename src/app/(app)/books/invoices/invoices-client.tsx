"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select-native";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { calendarDateKey } from "@/lib/accounting/dates";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABEL,
  type InvoiceStatus,
} from "@/lib/accounting/invoice";
import { FileText, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InvoiceListRow {
  id: string;
  number: string | null;
  status: string;
  billToName: string;
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  sentAt: string | null;
  reference: string | null;
  total: number;
  credited: number;
  paid: number;
  amountDue: number;
  isImported: boolean;
}

interface Props {
  invoices: InvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  status: InvoiceStatus | "overdue" | null;
  query: string;
  customer: string;
  customers: string[];
  /** Invoice counts per status for the current search and customer, plus all and overdue. */
  counts: Record<string, number>;
  owed: number;
  owedOverdue: number;
  canEdit: boolean;
}

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  SENT: "warning",
  PART_PAID: "warning",
  PAID: "success",
  VOID: "danger",
};

/** Overdue is a fact about an unpaid invoice, not a status we store. */
function isOverdue(invoice: InvoiceListRow, today: string): boolean {
  if (["PAID", "VOID", "DRAFT"].includes(invoice.status)) return false;
  return invoice.dueDate < today;
}

const CHIPS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  ...INVOICE_STATUSES.map((s) => ({ key: s, label: INVOICE_STATUS_LABEL[s] })),
];

export function InvoicesClient({ invoices, total, page, pageSize, status, query, customer, customers, counts, owed, owedOverdue, canEdit }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const today = calendarDateKey();
  const [text, setText] = useState(query);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(status || query || customer);

  function go(next: { status?: string | null; q?: string; customer?: string; page?: number }) {
    const params = new URLSearchParams(search.toString());
    const setOrDelete = (key: string, value: string | null | undefined) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    if (next.status !== undefined) setOrDelete("status", next.status);
    if (next.q !== undefined) setOrDelete("q", next.q);
    if (next.customer !== undefined) setOrDelete("customer", next.customer);
    if (next.status !== undefined || next.q !== undefined || next.customer !== undefined) params.delete("page");
    if (next.page !== undefined) params.set("page", String(next.page));
    router.push(`/books/invoices${params.size > 0 ? `?${params}` : ""}`);
  }

  // `go` is rebuilt every render; the debounce reads the latest one so it need not be a dependency.
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // Search as you type, after a short pause so each keystroke is not a page load.
  useEffect(() => {
    if (text === query) return;
    const t = setTimeout(() => goRef.current({ q: text.trim() }), 350);
    return () => clearTimeout(t);
  }, [text, query]);

  return (
    <>
      <Topbar
        title="Invoices"
        subtitle={owed > 0 ? `${formatPence(owed)} owed by customers` : "What customers owe"}
        breadcrumbs={[
          { label: "Accounting", href: "/books" },
          { label: "Invoices" },
        ]}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => router.push("/books/invoices/new")}>
              <Plus className="w-4 h-4" aria-hidden /> New invoice
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-4 lg:p-8 space-y-5">
        {/* Totals first: what is owed, and how much of it is late. */}
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-sm text-muted-foreground">Owed by customers</dt>
            <dd className="text-2xl font-bold tabular-nums">{formatPence(owed)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Overdue</dt>
            <dd className={cn("text-2xl font-bold tabular-nums", owedOverdue > 0 && "text-destructive")}>
              {owedOverdue > 0 && <span aria-hidden>▲ </span>}
              {formatPence(owedOverdue)}
              {counts.overdue > 0 && (
                <span className="ml-2 text-base font-semibold">
                  ({counts.overdue} invoice{counts.overdue === 1 ? "" : "s"})
                </span>
              )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <label htmlFor="invoice-search" className="sr-only">Search invoices</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
            <input
              id="invoice-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Number, customer or reference"
              className="w-full h-11 md:h-10 pl-9 pr-3 rounded-full border border-input bg-card text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
          </div>
          <Select
            aria-label="Customer"
            className="w-full sm:w-64"
            value={customer}
            onChange={(e) => go({ customer: e.target.value })}
          >
            <option value="">All customers</option>
            {customers.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText("");
                router.push("/books/invoices");
              }}
            >
              <X className="w-4 h-4" aria-hidden /> Clear filters
            </Button>
          )}
        </div>

        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {CHIPS.map(({ key, label }) => {
            const active = (status ?? "all") === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => go({ status: key === "all" ? null : key })}
                className={cn(
                  "inline-flex items-center gap-1.5 min-h-11 md:min-h-9 px-4 rounded-full border text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active ? "bg-primary text-primary-foreground border-primary" : "border-input text-foreground hover:bg-accent"
                )}
              >
                {active && <span aria-hidden>✓</span>}
                {label} <span className="tabular-nums font-normal">({counts[key] ?? 0})</span>
              </button>
            );
          })}
        </div>

        {invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filtered ? "No invoices match these filters" : "No invoices yet"}
            description={
              filtered
                ? "Try a different status, customer or search, or clear the filters."
                : "Raise one and it will appear here as a draft until you approve it."
            }
            actionLabel={filtered ? "Clear filters" : canEdit ? "New invoice" : undefined}
            onAction={
              filtered
                ? () => {
                    setText("");
                    router.push("/books/invoices");
                  }
                : canEdit
                  ? () => router.push("/books/invoices/new")
                  : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Invoices, {from} to {to} of {total}
              </caption>
              <thead className="text-muted-foreground">
                <tr className="border-b-2 border-input">
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Number</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Customer</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Issued</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Due</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Total</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Still due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoices.map((invoice) => {
                  const late = isOverdue(invoice, today);
                  return (
                    <tr key={invoice.id} className="hover:bg-accent/60">
                      <td className="px-3 py-3">
                        <Link href={`/books/invoices/${invoice.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                          {invoice.number ?? "Draft"}
                        </Link>
                        {invoice.reference && (
                          <span className="block text-xs text-muted-foreground">{invoice.reference}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">{invoice.billToName}</td>
                      <td className="px-3 py-3 text-muted-foreground tabular-nums">{formatDate(invoice.issueDate)}</td>
                      <td className="px-3 py-3 text-muted-foreground tabular-nums">
                        {formatDate(invoice.dueDate)}
                        {late && (
                          <Badge variant="danger" size="sm" className="ml-2">
                            Overdue
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={STATUS_VARIANT[invoice.status] ?? "neutral"} size="sm">
                          {INVOICE_STATUS_LABEL[invoice.status as InvoiceStatus] ?? invoice.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPence(invoice.total)}</td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", late && "font-semibold text-destructive")}>
                        {invoice.amountDue > 0 ? formatPence(invoice.amountDue) : <span className="text-muted-foreground">–</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Subtotal for this page, lined up with the money columns. */}
              <tfoot>
                <tr className="border-t-2 border-input font-semibold">
                  <th scope="row" colSpan={5} className="px-3 py-3 text-left">
                    This page ({invoices.length} invoice{invoices.length === 1 ? "" : "s"})
                  </th>
                  <td className="px-3 py-3 text-right tabular-nums">{formatPence(invoices.reduce((s, i) => s + i.total, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatPence(invoices.reduce((s, i) => s + i.amountDue, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {total > 0 ? `${from}–${to} of ${total}` : ""}
          </span>
          {lastPage > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => go({ page: page + 1 })}>
                Next
              </Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
