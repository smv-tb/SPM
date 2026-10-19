"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JournalForm, type BooksAccount } from "@/components/books/JournalForm";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { BookOpen, Plus } from "lucide-react";

export interface JournalRow {
  id: string;
  number: number | null;
  date: string;
  memo: string;
  reference: string | null;
  status: string;
  sourceType: string;
  totalDebit: number;
}

interface Props {
  initialEntries: JournalRow[];
  accounts: BooksAccount[];
  canPost: boolean;
  filters: { status: string; from: string; to: string };
  pagination: { page: number; pageSize: number; total: number };
}

export function JournalsClient({ initialEntries, accounts, canPost, filters, pagination }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState(filters.status);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  // Filtering happens on the server so paging and totals stay consistent.
  function applyFilters(next: { status?: string; from?: string; to?: string }) {
    const params = new URLSearchParams();
    const merged = { status, from, to, ...next };
    if (merged.status) params.set("status", merged.status);
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    router.push(`/books/journals${params.toString() ? `?${params}` : ""}`);
  }

  // Paging follows the filters as applied (in the URL), not unsaved edits in the inputs.
  function goToPage(page: number) {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (page > 1) params.set("page", String(page));
    router.push(`/books/journals${params.toString() ? `?${params}` : ""}`);
  }

  const firstShown = (pagination.page - 1) * pagination.pageSize + 1;
  const lastShown = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const filtered = Boolean(filters.status || filters.from || filters.to);

  return (
    <>
      <Topbar
        title="Journals"
        subtitle="Every entry in the general ledger"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Journals", href: "/books/journals" },
        ]}
        actions={
          canPost ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="w-3.5 h-3.5" /> New journal
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="status">
                Status
              </label>
              <Select
                id="status"
                className="w-40"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  applyFilters({ status: e.target.value });
                }}
              >
                <option value="">All</option>
                <option value="DRAFT">Drafts</option>
                <option value="POSTED">Posted</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="from">
                From
              </label>
              <Input id="from" type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="to">
                To
              </label>
              <Input id="to" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" onClick={() => applyFilters({})}>
              Apply
            </Button>
            {(status || from || to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatus("");
                  setFrom("");
                  setTo("");
                  router.push("/books/journals");
                }}
              >
                Clear
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-0 pb-0">
            {initialEntries.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={filtered ? "No journals match these filters" : "No journals yet"}
                description={
                  filtered
                    ? "Clear or widen the filters to see more."
                    : canPost
                      ? "Record a journal to start the books, or post one from an imported bank line later."
                      : "Nothing has been posted to the ledger yet."
                }
                actionLabel={canPost && !filtered ? "New journal" : undefined}
                onAction={canPost && !filtered ? () => setCreating(true) : undefined}
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground w-24">No.</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-32">Date</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-full">
                      Description
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-32">Amount</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-28">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {initialEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 tabular-nums text-muted-foreground">
                        <Link href={`/books/journals/${entry.id}`} className="hover:text-primary">
                          {entry.number ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDate(entry.date)}</td>
                      <td className="px-3 py-3">
                        <Link href={`/books/journals/${entry.id}`} className="font-medium hover:text-primary">
                          {entry.memo}
                        </Link>
                        {entry.reference && (
                          <span className="text-muted-foreground"> · {entry.reference}</span>
                        )}
                        {entry.sourceType === "REVERSAL" && (
                          <Badge variant="neutral" size="sm" className="ml-2">
                            Reversal
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPence(entry.totalDebit)}</td>
                      <td className="px-3 py-3">
                        <Badge variant={entry.status === "POSTED" ? "success" : "neutral"} size="sm">
                          {entry.status === "POSTED" ? "Posted" : "Draft"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pagination.total > pagination.pageSize && (
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border text-sm">
                <span className="text-muted-foreground tabular-nums">
                  {firstShown}–{lastShown} of {pagination.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1}
                    onClick={() => goToPage(pagination.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={lastShown >= pagination.total}
                    onClick={() => goToPage(pagination.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>New journal</DialogTitle>
          </DialogHeader>
          <JournalForm
            accounts={accounts}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
