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
import { cn, formatDate } from "@/lib/utils";
import { calendarDateKey } from "@/lib/accounting/dates";
import { BILL_STATUSES, BILL_STATUS_LABEL, type BillStatus } from "@/lib/accounting/bill";
import { Paperclip, Plus, Receipt, Search, X } from "lucide-react";

export interface BillListRow {
  id: string;
  status: string;
  supplierName: string;
  supplierReference: string | null;
  issueDate: string;
  dueDate: string;
  total: number;
  amountDue: number;
  attachmentCount: number;
}

interface Props {
  bills: BillListRow[];
  total: number;
  page: number;
  pageSize: number;
  status: BillStatus | "overdue" | null;
  query: string;
  supplier: string;
  suppliers: string[];
  /** Bill counts per status for the current search and supplier, plus all and overdue. */
  counts: Record<string, number>;
  owed: number;
  owedOverdue: number;
  canEdit: boolean;
}

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  PART_PAID: "warning",
  PAID: "success",
  VOID: "danger",
};

/** Overdue is a fact about an unpaid bill, not a status we store. */
function isOverdue(bill: BillListRow, today: string): boolean {
  return bill.amountDue > 0 && bill.dueDate < today;
}

const CHIPS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  ...BILL_STATUSES.map((s) => ({ key: s, label: BILL_STATUS_LABEL[s] })),
];

export function BillsClient({ bills, total, page, pageSize, status, query, supplier, suppliers, counts, owed, owedOverdue, canEdit }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const today = calendarDateKey();
  const [text, setText] = useState(query);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(status || query || supplier);

  function go(next: { status?: string | null; q?: string; supplier?: string; page?: number }) {
    const params = new URLSearchParams(search.toString());
    const setOrDelete = (key: string, value: string | null | undefined) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    if (next.status !== undefined) setOrDelete("status", next.status);
    if (next.q !== undefined) setOrDelete("q", next.q);
    if (next.supplier !== undefined) setOrDelete("supplier", next.supplier);
    if (next.status !== undefined || next.q !== undefined || next.supplier !== undefined) params.delete("page");
    if (next.page !== undefined) params.set("page", String(next.page));
    router.push(`/books/bills${params.size > 0 ? `?${params}` : ""}`);
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

  const clear = () => {
    setText("");
    router.push("/books/bills");
  };

  return (
    <>
      <Topbar
        title="Bills"
        subtitle={owed > 0 ? `${formatPence(owed)} owed to suppliers` : "What we owe suppliers"}
        breadcrumbs={[{ label: "Accounting", href: "/books" }, { label: "Bills" }]}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => router.push("/books/bills/new")}>
              <Plus className="w-4 h-4" aria-hidden /> New bill
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-4 lg:p-8 space-y-5">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-sm text-muted-foreground">Owed to suppliers</dt>
            <dd className="text-2xl font-bold tabular-nums">{formatPence(owed)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Overdue</dt>
            <dd className={cn("text-2xl font-bold tabular-nums", owedOverdue > 0 && "text-destructive")}>
              {owedOverdue > 0 && <span aria-hidden>▲ </span>}
              {formatPence(owedOverdue)}
              {counts.overdue > 0 && (
                <span className="ml-2 text-base font-semibold">
                  ({counts.overdue} bill{counts.overdue === 1 ? "" : "s"})
                </span>
              )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <label htmlFor="bill-search" className="sr-only">Search bills</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
            <input
              id="bill-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Supplier, their reference or notes"
              className="w-full h-11 md:h-10 pl-9 pr-3 rounded-full border border-input bg-card text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
          </div>
          <Select aria-label="Supplier" className="w-full sm:w-64" value={supplier} onChange={(e) => go({ supplier: e.target.value })}>
            <option value="">All suppliers</option>
            {suppliers.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clear}>
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

        {bills.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={filtered ? "No bills match these filters" : "No bills yet"}
            description={
              filtered
                ? "Try a different status, supplier or search, or clear the filters."
                : "Enter a supplier's invoice and it will appear here as a draft until you approve it."
            }
            actionLabel={filtered ? "Clear filters" : canEdit ? "New bill" : undefined}
            onAction={filtered ? clear : canEdit ? () => router.push("/books/bills/new") : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Bills, {from} to {to} of {total}
              </caption>
              <thead className="text-muted-foreground">
                <tr className="border-b-2 border-input">
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Supplier</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Their reference</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Dated</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Due</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Total</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Still owed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bills.map((bill) => {
                  const late = isOverdue(bill, today);
                  return (
                    <tr key={bill.id} className="hover:bg-accent/60">
                      <td className="px-3 py-3">
                        <Link href={`/books/bills/${bill.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                          {bill.supplierName}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        {bill.supplierReference ?? <span className="text-muted-foreground">–</span>}
                        {bill.attachmentCount > 0 && (
                          <Paperclip className="inline w-3.5 h-3.5 ml-1.5 text-muted-foreground" aria-label={`${bill.attachmentCount} attached`} />
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground tabular-nums">{formatDate(bill.issueDate)}</td>
                      <td className="px-3 py-3 text-muted-foreground tabular-nums">
                        {formatDate(bill.dueDate)}
                        {late && (
                          <Badge variant="danger" size="sm" className="ml-2">
                            Overdue
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={STATUS_VARIANT[bill.status] ?? "neutral"} size="sm">
                          {BILL_STATUS_LABEL[bill.status as BillStatus] ?? bill.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPence(bill.total)}</td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", late && "font-semibold text-destructive")}>
                        {bill.amountDue > 0 ? formatPence(bill.amountDue) : <span className="text-muted-foreground">–</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-input font-semibold">
                  <th scope="row" colSpan={5} className="px-3 py-3 text-left">
                    This page ({bills.length} bill{bills.length === 1 ? "" : "s"})
                  </th>
                  <td className="px-3 py-3 text-right tabular-nums">{formatPence(bills.reduce((s, b) => s + b.total, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatPence(bills.reduce((s, b) => s + b.amountDue, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">{total > 0 ? `${from}–${to} of ${total}` : ""}</span>
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
