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
import { EmptyState } from "@/components/ui/empty-state";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { SerializedBankAccount } from "@/lib/accounting/serialize";
import type { ReconcileView } from "@/lib/accounting/reconciliation";
import type { Candidate, Confidence } from "@/lib/accounting/reconcile-match";
import { CheckCircle2, Wand2 } from "lucide-react";

interface Recent {
  id: string;
  method: string;
  createdAt: string;
  statement: { date: string; description: string; amount: number }[];
  books: { entryId: string; label: string; number: number | null }[];
}

interface Props {
  account: SerializedBankAccount;
  view: ReconcileView;
  accounts: { id: string; code: string; name: string; type: string }[];
  recent: Recent[];
  canReconcile: boolean;
}

const CONFIDENCE: Record<Confidence, { label: string; variant: "success" | "warning" | "neutral" }> = {
  HIGH: { label: "Sure", variant: "success" },
  MEDIUM: { label: "Likely", variant: "warning" },
  LOW: { label: "Possible", variant: "neutral" },
};

export function ReconcileClient({ account, view, accounts, recent, canReconcile }: Props) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState<Record<string, { accountId: string; memo: string } | undefined>>({});
  const [paying, setPaying] = useState<Record<string, { contactId: string; ids: string[] } | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const suggestionFor = new Map(view.suggestions.map((s) => [s.statementLineId, s]));
  const autoCount = view.suggestions.filter((s) => s.auto).length;
  const base = `/api/books/bank-accounts/${account.id}/reconcile`;

  // Money in pays customers' invoices; money out pays suppliers' bills.
  const invoices = view.openInvoices.map((i) => ({ ...i, label: i.number }));
  const bills = view.openBills.map((b) => ({ ...b, label: b.reference ?? "Bill" }));
  const contactsOf = (docs: { contactId: string; contactName: string }[]) => [
    ...new Map(docs.map((d) => [d.contactId, d.contactName])).entries(),
  ];
  const customers = contactsOf(invoices);
  const suppliers = contactsOf(bills);

  async function send(path: string, init: RequestInit, success?: string) {
    setBusy(true);
    setMessage(null);
    const res = await clientFetch(path, init);
    setBusy(false);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ tone: "error", text: payload.error ?? `Request failed (${res.status})` });
      return null;
    }
    if (success) setMessage({ tone: "ok", text: success });
    router.refresh();
    return payload;
  }

  async function accept(lineId: string, c: Candidate) {
    if (c.kind === "BOOK") {
      await send(`${base}/match`, {
        method: "POST",
        body: JSON.stringify({ statementLineIds: [lineId], journalLineIds: c.journalLineIds }),
      });
    } else if (c.kind === "BILL") {
      await send(`${base}/bills`, {
        method: "POST",
        body: JSON.stringify({ statementLineId: lineId, billIds: c.billIds }),
      });
    } else {
      await send(`${base}/invoices`, {
        method: "POST",
        body: JSON.stringify({ statementLineId: lineId, invoiceIds: c.invoiceIds }),
      });
    }
  }

  async function auto() {
    const result = await send(`${base}/auto`, { method: "POST" });
    if (result) {
      setMessage({
        tone: "ok",
        text: `Matched ${result.matched} line${result.matched === 1 ? "" : "s"}${
          result.paymentsRecorded ? `, recording ${result.paymentsRecorded} payment${result.paymentsRecorded === 1 ? "" : "s"}` : ""
        }. ${result.left} left to look at.`,
      });
    }
  }

  return (
    <>
      <Topbar
        title="Reconcile"
        subtitle={`${account.name} · ${account.sortCode} · ${account.accountNumberMasked}`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Bank", href: "/books/bank" },
          { label: account.name, href: `/books/bank/${account.id}` },
          { label: "Reconcile", href: `/books/bank/${account.id}/reconcile` },
        ]}
        actions={
          canReconcile && autoCount > 0 ? (
            <Button size="sm" disabled={busy} onClick={auto}>
              <Wand2 className="w-3.5 h-3.5" /> Auto-reconcile {autoCount}
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <p className="text-sm text-muted-foreground">
          {view.lines.length === 0
            ? "Every statement line is reconciled."
            : `${view.lines.length} statement line${view.lines.length === 1 ? "" : "s"} to reconcile; ${autoCount} can be matched automatically. Only matches marked Sure are applied automatically — everything else waits for you.`}
        </p>

        {message && (
          <div
            className={
              message.tone === "ok"
                ? "rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700"
                : "rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
            }
          >
            {message.text}
          </div>
        )}

        {view.lines.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState icon={CheckCircle2} title="All reconciled" description="Import the next statement when it is ready." />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {view.lines.map((line) => {
              const suggestion = suggestionFor.get(line.id);
              const candidates = suggestion?.candidates ?? [];
              const pick = candidates[chosen[line.id] ?? 0];
              const create = creating[line.id];
              const pay = paying[line.id];
              const moneyIn = line.amount > 0;
              const docs = moneyIn ? invoices : bills;
              const contacts = moneyIn ? customers : suppliers;
              const words = moneyIn
                ? { party: "Customer paying…", docs: "invoices", extra: "the customer's credit", endpoint: "invoices", key: "invoiceIds", start: "Mark as customer payment…" }
                : { party: "Supplier paid…", docs: "bills", extra: "paid on account", endpoint: "bills", key: "billIds", start: "Mark as supplier payment…" };
              const size = Math.abs(line.amount);
              const payDocs = pay ? docs.filter((d) => d.contactId === pay.contactId) : [];
              const payTotal = payDocs.filter((d) => pay?.ids.includes(d.id)).reduce((n, d) => n + d.amountDue, 0);
              return (
                <Card key={line.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{line.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(line.date)}
                          {line.type ? ` · ${line.type}` : ""}
                        </p>
                      </div>
                      <p className={`tabular-nums font-semibold ${line.amount > 0 ? "text-emerald-700" : ""}`}>
                        {formatPence(line.amount)}
                      </p>
                    </div>

                    {pick ? (
                      <div className="rounded-lg border border-border p-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={CONFIDENCE[pick.confidence].variant} size="sm">
                              {CONFIDENCE[pick.confidence].label}
                            </Badge>
                            <span>{pick.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {pick.reasons.join(" · ")}
                            {pick.kind !== "BOOK" && " · matching records the payment"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {candidates.length > 1 && (
                            <Select
                              aria-label={`Other matches for ${line.description}`}
                              className="w-56"
                              value={String(chosen[line.id] ?? 0)}
                              onChange={(e) => setChosen({ ...chosen, [line.id]: Number(e.target.value) })}
                            >
                              {candidates.map((c, i) => (
                                <option key={i} value={i}>
                                  {CONFIDENCE[c.confidence].label}: {c.label}
                                </option>
                              ))}
                            </Select>
                          )}
                          {canReconcile && (
                            <Button size="sm" disabled={busy} onClick={() => accept(line.id, pick)}>
                              Match
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Nothing in the books matches this yet.</p>
                    )}

                    {canReconcile && line.amount !== 0 && contacts.length > 0 && !create &&
                      (pay ? (
                        <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
                          <Select
                            aria-label={`${moneyIn ? "Customer" : "Supplier"} for ${line.description}`}
                            className="w-64"
                            value={pay.contactId}
                            onChange={(e) =>
                              setPaying({
                                ...paying,
                                [line.id]: {
                                  contactId: e.target.value,
                                  ids: docs.filter((d) => d.contactId === e.target.value).map((d) => d.id),
                                },
                              })
                            }
                          >
                            <option value="">{words.party}</option>
                            {contacts.map(([id, name]) => (
                              <option key={id} value={id}>
                                {name}
                              </option>
                            ))}
                          </Select>
                          {payDocs.map((d) => (
                            <label key={d.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={pay.ids.includes(d.id)}
                                onChange={(e) =>
                                  setPaying({
                                    ...paying,
                                    [line.id]: {
                                      ...pay,
                                      ids: e.target.checked
                                        ? payDocs.filter((x) => x.id === d.id || pay.ids.includes(x.id)).map((x) => x.id)
                                        : pay.ids.filter((x) => x !== d.id),
                                    },
                                  })
                                }
                              />
                              <span>
                                {d.label} · {formatDate(d.issueDate)} · {formatPence(d.amountDue)} owed
                              </span>
                            </label>
                          ))}
                          {pay.ids.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {payTotal === size
                                ? `Exactly what these ${words.docs} owe.`
                                : payTotal > size
                                  ? `The money covers the oldest first; ${formatPence(payTotal - size)} of these stays owed.`
                                  : `${formatPence(size - payTotal)} more than these owe; the extra is kept as ${words.extra}.`}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={busy || pay.ids.length === 0}
                              onClick={() =>
                                send(
                                  `${base}/${words.endpoint}`,
                                  { method: "POST", body: JSON.stringify({ statementLineId: line.id, [words.key]: pay.ids }) },
                                  "Payment recorded and matched."
                                ).then((ok) => ok && setPaying({ ...paying, [line.id]: undefined }))
                              }
                            >
                              Record payment and match
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPaying({ ...paying, [line.id]: undefined })}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => setPaying({ ...paying, [line.id]: { contactId: "", ids: [] } })}
                        >
                          {words.start}
                        </Button>
                      ))}

                    {canReconcile &&
                      (create ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <Select
                            aria-label={`Account for ${line.description}`}
                            className="w-64"
                            value={create.accountId}
                            onChange={(e) => setCreating({ ...creating, [line.id]: { ...create, accountId: e.target.value } })}
                          >
                            <option value="">Post to account…</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </Select>
                          <Input
                            aria-label={`Memo for ${line.description}`}
                            className="w-64"
                            placeholder={line.description}
                            value={create.memo}
                            onChange={(e) => setCreating({ ...creating, [line.id]: { ...create, memo: e.target.value } })}
                          />
                          <Button
                            size="sm"
                            disabled={busy || !create.accountId}
                            onClick={() =>
                              send(`${base}/create`, {
                                method: "POST",
                                body: JSON.stringify({
                                  statementLineId: line.id,
                                  accountId: create.accountId,
                                  memo: create.memo.trim() || null,
                                }),
                              }).then((ok) => ok && setCreating({ ...creating, [line.id]: undefined }))
                            }
                          >
                            Post and match
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setCreating({ ...creating, [line.id]: undefined })}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCreating({ ...creating, [line.id]: { accountId: "", memo: "" } })}
                        >
                          {line.amount < 0
                            ? suppliers.length > 0
                              ? "Other money out (not a bill)…"
                              : "Spend money…"
                            : customers.length > 0
                              ? "Other money in (not an invoice)…"
                              : "Receive money…"}
                        </Button>
                      ))}
                    {canReconcile && contacts.length > 0 && create && (
                      <p className="text-xs text-amber-700">
                        {moneyIn
                          ? "Invoices already count as income. If this money pays one, cancel and mark it as a customer payment instead, or the income is counted twice."
                          : "Bills already count as costs. If this money pays one, cancel and mark it as a supplier payment instead, or the cost is counted twice."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {view.bookOnly.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>In the books, not yet on the statement</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {view.bookOnly.map((b) => (
                    <tr key={b.journalLineId}>
                      <td className="px-5 py-2 whitespace-nowrap">{formatDate(b.date)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/books/journals/${b.entryId}`} className="text-primary hover:underline">
                          {b.journalNumber ? `#${b.journalNumber} ` : ""}
                          {b.label}
                        </Link>
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums">{formatPence(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-xs text-muted-foreground">
                Usually money in transit, or an entry dated after the last statement imported. If one never
                appears on a statement, it may not have happened.
              </p>
            </CardContent>
          </Card>
        )}

        {recent.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recently reconciled</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2">
                        {r.statement.map((s) => (
                          <span key={s.description + s.date} className="block">
                            {formatDate(s.date)} · {s.description} ·{" "}
                            <span className="tabular-nums">{formatPence(s.amount)}</span>
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.books.map((b) => (
                          <Link key={b.entryId} href={`/books/journals/${b.entryId}`} className="block hover:underline">
                            {b.label}
                          </Link>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={r.method === "AUTO" ? "success" : "neutral"} size="sm">
                          {r.method === "AUTO" ? "Auto" : "Manual"}
                        </Badge>
                      </td>
                      <td className="px-5 py-2 text-right">
                        {canReconcile && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              send(`/api/books/reconciliations/${r.id}`, { method: "DELETE" }, "Unmatched. Anything the match created is still in the books.")
                            }
                          >
                            Unmatch
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
      </main>
    </>
  );
}
