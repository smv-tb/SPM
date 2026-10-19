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
import { JournalForm, type BooksAccount } from "@/components/books/JournalForm";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { calendarDateKey } from "@/lib/accounting/dates";
import { Undo2 } from "lucide-react";

export interface JournalDetail {
  id: string;
  number: number | null;
  date: string;
  memo: string;
  reference: string | null;
  status: string;
  sourceType: string;
  reversesId: string | null;
  reversedBy: { id: string; number: number | null } | null;
  postedAt: string | null;
  postedByName: string | null;
  createdByName: string | null;
  lines: {
    id: string;
    accountId: string;
    accountCode: string;
    accountName: string;
    description: string | null;
    debit: number;
    credit: number;
  }[];
}

interface Props {
  entry: JournalDetail;
  accounts: BooksAccount[];
  canPost: boolean;
}

export function JournalDetailClient({ entry, accounts, canPost }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reversalDate, setReversalDate] = useState(() => calendarDateKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isDraft = entry.status === "DRAFT";
  const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = entry.lines.reduce((s, l) => s + l.credit, 0);

  async function act(path: string, method: string, body?: unknown, onDone?: () => void) {
    setBusy(true);
    setError("");
    const res = await clientFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const problems = (payload.problems ?? []) as { message: string }[];
      setError([payload.error, ...problems.map((p) => p.message)].filter(Boolean).join(" — "));
      return;
    }
    onDone?.();
  }

  return (
    <>
      <Topbar
        title={entry.number ? `Journal #${entry.number}` : "Draft journal"}
        subtitle={entry.memo}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Journals", href: "/books/journals" },
          { label: entry.number ? `#${entry.number}` : "Draft" },
        ]}
        actions={
          canPost ? (
            <div className="flex gap-2">
              {isDraft && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={async () =>
                      (await confirmDialog("Delete this draft?")) &&
                      act(`/api/books/journals/${entry.id}`, "DELETE", undefined, () =>
                        router.push("/books/journals")
                      )
                    }
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => act(`/api/books/journals/${entry.id}/post`, "POST", undefined, () => router.refresh())}
                  >
                    Post
                  </Button>
                </>
              )}
              {!isDraft && !entry.reversedBy && entry.sourceType !== "REVERSAL" && (
                <Button variant="outline" size="sm" onClick={() => setReversing(true)}>
                  <Undo2 className="w-3.5 h-3.5" /> Reverse
                </Button>
              )}
            </div>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle>{formatDate(entry.date)}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={isDraft ? "neutral" : "success"} size="sm">
                  {isDraft ? "Draft" : "Posted"}
                </Badge>
                {entry.sourceType === "REVERSAL" && (
                  <Badge variant="info" size="sm">
                    Reversal
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground">Account</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-full">
                    Description
                  </th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-32">Debit</th>
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground w-32">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entry.lines.map((line) => (
                  <tr key={line.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Link href={`/books/accounts/${line.accountId}`} className="hover:text-primary">
                        <span className="tabular-nums text-muted-foreground">{line.accountCode}</span>{" "}
                        {line.accountName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{line.description ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {line.debit ? formatPence(line.debit) : ""}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {line.credit ? formatPence(line.credit) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30">
                <tr className="font-semibold">
                  <td className="px-5 py-3" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatPence(totalDebit)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatPence(totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 text-sm space-y-2">
            {entry.reference && (
              <p>
                <span className="text-muted-foreground">Reference: </span>
                {entry.reference}
              </p>
            )}
            {entry.postedAt && (
              <p className="text-muted-foreground">
                Posted {formatDate(entry.postedAt)}
                {entry.postedByName ? ` by ${entry.postedByName}` : ""}
              </p>
            )}
            {entry.createdByName && <p className="text-muted-foreground">Created by {entry.createdByName}</p>}
            {entry.reversedBy && (
              <p>
                Reversed by{" "}
                <Link href={`/books/journals/${entry.reversedBy.id}`} className="text-primary hover:underline">
                  journal #{entry.reversedBy.number}
                </Link>
              </p>
            )}
            {entry.reversesId && (
              <p>
                Reverses{" "}
                <Link href={`/books/journals/${entry.reversesId}`} className="text-primary hover:underline">
                  the original journal
                </Link>
              </p>
            )}
            {!isDraft && (
              <p className="text-xs text-muted-foreground">
                Posted journals cannot be edited or deleted. Correct them with a reversal.
              </p>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit draft</DialogTitle>
          </DialogHeader>
          <JournalForm
            accounts={accounts}
            entry={entry}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={reversing} onOpenChange={setReversing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse journal #{entry.number}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This posts a mirror image of the journal. The original stays exactly as it is.
          </p>
          <div className="mt-4">
            <FormLabel htmlFor="reversal-date">Date of the reversal</FormLabel>
            <Input
              id="reversal-date"
              type="date"
              value={reversalDate}
              onChange={(e) => setReversalDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReversing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                act(`/api/books/journals/${entry.id}/reverse`, "POST", { date: reversalDate }, () => {
                  setReversing(false);
                  router.refresh();
                })
              }
            >
              {busy ? "Working…" : "Post reversal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
