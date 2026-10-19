"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { SerializedBankAccount } from "@/lib/accounting/serialize";
import { CheckCircle2, FileUp, Upload, Wand2 } from "lucide-react";

interface Line {
  id: string;
  date: string;
  type: string | null;
  description: string;
  amount: number;
  balance: number | null;
  reconciled: boolean;
}

interface ImportRow {
  id: string;
  fileName: string;
  status: string;
  lineCount: number;
  duplicateCount: number;
  firstDate: string | null;
  lastDate: string | null;
  createdAt: string;
  createdBy: string | null;
  reconciled: number;
}

interface Props {
  account: SerializedBankAccount;
  lines: Line[];
  total: number;
  page: number;
  pageSize: number;
  imports: ImportRow[];
  canImport: boolean;
}

export function BankAccountClient({ account, lines, total, page, pageSize, imports, canImport }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const difference =
    account.statementBalance !== null && account.statementBalance !== undefined
      ? account.statementBalance - (account.booksBalance ?? 0)
      : null;

  async function undo(id: string, fileName: string) {
    if (!await confirmDialog({ message: `Undo the import of ${fileName}? Its lines are removed; the record of the import stays.`, title: "Undo this import?", confirmLabel: "Undo import" })) return;
    setBusy(true);
    setError("");
    const res = await clientFetch(`/api/books/statement-imports/${id}/undo`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Could not undo (${res.status})`);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Topbar
        title={account.name}
        subtitle={`${account.sortCode} · ${account.accountNumberMasked} · books to ${account.ledgerAccountCode} ${account.ledgerAccountName}`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Bank", href: "/books/bank" },
          { label: account.name, href: `/books/bank/${account.id}` },
        ]}
        actions={
          <div className="flex gap-2">
            {(account.unreconciled ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={() => router.push(`/books/bank/${account.id}/reconcile`)}>
                <Wand2 className="w-3.5 h-3.5" /> Reconcile
              </Button>
            )}
            {canImport && !account.isArchived && (
              <Button size="sm" onClick={() => router.push(`/books/bank/${account.id}/import`)}>
                <Upload className="w-3.5 h-3.5" /> Import statement
              </Button>
            )}
          </div>
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Statement balance</p>
              <p className="text-xl font-semibold tabular-nums">
                {account.statementBalance !== null && account.statementBalance !== undefined
                  ? formatPence(account.statementBalance)
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {account.statementDate ? `as at ${formatDate(account.statementDate)}` : "No statement imported yet"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Books balance</p>
              <p className="text-xl font-semibold tabular-nums">{formatPence(account.booksBalance ?? 0)}</p>
              <p className="text-xs text-muted-foreground">
                {difference === null || difference === 0
                  ? "All postings to date"
                  : `${formatPence(Math.abs(difference))} ${difference > 0 ? "less" : "more"} than the statement`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">To reconcile</p>
              <p className="text-xl font-semibold tabular-nums">{account.unreconciled ?? 0}</p>
              <p className="text-xs text-muted-foreground">statement lines not yet matched to the books</p>
            </CardContent>
          </Card>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {imports.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Imports</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-semibold">File</th>
                    <th className="px-3 py-2 text-left font-semibold">Covers</th>
                    <th className="px-3 py-2 text-right font-semibold">Lines</th>
                    <th className="px-3 py-2 text-left font-semibold">Imported</th>
                    <th className="px-5 py-2 text-right font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {imports.map((i) => (
                    <tr key={i.id}>
                      <td className="px-5 py-2">
                        {i.fileName}
                        {i.status === "UNDONE" && (
                          <Badge variant="neutral" size="sm" className="ml-2">
                            Undone
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {i.firstDate && i.lastDate ? `${formatDate(i.firstDate)} – ${formatDate(i.lastDate)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {i.lineCount}
                        {i.duplicateCount > 0 && (
                          <span className="block text-xs text-muted-foreground">{i.duplicateCount} already held</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(i.createdAt.slice(0, 10))}
                        {i.createdBy ? ` by ${i.createdBy}` : ""}
                      </td>
                      <td className="px-5 py-2 text-right">
                        {canImport && i.status === "IMPORTED" && i.reconciled === 0 && (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => undo(i.id, i.fileName)}>
                            Undo
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Statement</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {lines.length === 0 ? (
              <EmptyState
                icon={FileUp}
                title="No statement lines yet"
                description="Export a statement from Lloyds online banking as CSV, then import it here."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-semibold">Date</th>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-left font-semibold">Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-5 py-2 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-5 py-2 whitespace-nowrap">{formatDate(l.date)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.type ?? ""}</td>
                      <td className="px-3 py-2">
                        {l.description}
                        {l.reconciled && (
                          <CheckCircle2 aria-label="Reconciled" className="inline w-3.5 h-3.5 ml-1.5 text-emerald-600" />
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.amount > 0 ? "text-emerald-700" : ""}`}>
                        {formatPence(l.amount)}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">
                        {l.balance === null ? "" : formatPence(l.balance)}
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
            <span className="text-sm text-muted-foreground">
              Page {page} of {lastPage}
            </span>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => router.push(`?page=${page - 1}`)}>
              Newer
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => router.push(`?page=${page + 1}`)}>
              Older
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
