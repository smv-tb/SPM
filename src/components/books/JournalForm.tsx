"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence, toPence } from "@/lib/money";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/accounting/chart";
import { calendarDateKey } from "@/lib/accounting/dates";
import { Plus, Trash2 } from "lucide-react";

export interface BooksAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

export interface JournalLineValue {
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

export interface ExistingJournal {
  id: string;
  date: string;
  memo: string;
  reference: string | null;
  lines: {
    accountId: string;
    description: string | null;
    debit: number;
    credit: number;
  }[];
}

interface Props {
  accounts: BooksAccount[];
  entry?: ExistingJournal | null;
  onSaved: () => void;
  onCancel: () => void;
}

interface Problem {
  code: string;
  message: string;
  line?: number;
}

const emptyLine = (): JournalLineValue => ({ accountId: "", description: "", debit: "", credit: "" });

/** Pence for the running totals; unparseable text shows as zero until submit reports it. */
function safePence(value: string): number {
  if (!value.trim()) return 0;
  try {
    return toPence(value);
  } catch {
    return 0;
  }
}

export function JournalForm({ accounts, entry, onSaved, onCancel }: Props) {
  const [date, setDate] = useState(entry?.date ?? calendarDateKey());
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [lines, setLines] = useState<JournalLineValue[]>(
    entry
      ? entry.lines.map((l) => ({
          accountId: l.accountId,
          description: l.description ?? "",
          debit: l.debit ? (l.debit / 100).toFixed(2) : "",
          credit: l.credit ? (l.credit / 100).toFixed(2) : "",
        }))
      : [emptyLine(), emptyLine()]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + safePence(l.debit), 0);
    const credit = lines.reduce((s, l) => s + safePence(l.credit), 0);
    return { debit, credit, difference: debit - credit };
  }, [lines]);

  const byType = useMemo(() => {
    const groups = new Map<AccountType, BooksAccount[]>();
    for (const type of ACCOUNT_TYPES) groups.set(type, []);
    for (const account of accounts) groups.get(account.type)?.push(account);
    return groups;
  }, [accounts]);

  function setLine(index: number, patch: Partial<JournalLineValue>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit(post: boolean) {
    setSaving(true);
    setError("");
    setProblems([]);

    const payload = {
      date,
      memo,
      reference: reference.trim() || null,
      post,
      lines: lines
        .filter((l) => l.accountId && (l.debit.trim() || l.credit.trim()))
        .map((l) => ({
          accountId: l.accountId,
          description: l.description.trim() || null,
          debit: l.debit.trim() || null,
          credit: l.credit.trim() || null,
        })),
    };

    const res = await clientFetch(entry ? `/api/books/journals/${entry.id}` : "/api/books/journals", {
      method: entry ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not save (${res.status})`);
      setProblems(body.problems ?? []);
      setSaving(false);
      return;
    }

    // Posting is a second step when editing an existing draft.
    if (post && entry) {
      const postRes = await clientFetch(`/api/books/journals/${entry.id}/post`, { method: "POST" });
      if (!postRes.ok) {
        const body = await postRes.json().catch(() => ({}));
        setError(body.error ?? `Could not post (${postRes.status})`);
        setProblems(body.problems ?? []);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  const lineProblems = (index: number) => problems.filter((p) => p.line === index + 1);
  const generalProblems = problems.filter((p) => p.line === undefined);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <FormLabel htmlFor="journal-date">Date</FormLabel>
          <Input
            id="journal-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <FormLabel htmlFor="journal-memo">Description</FormLabel>
          <Input
            id="journal-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What this journal records"
            required
            maxLength={300}
          />
        </div>
      </div>

      <div>
        <FormLabel htmlFor="journal-reference">Reference (optional)</FormLabel>
        <Input
          id="journal-reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Invoice number, statement line…"
          maxLength={100}
        />
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Account</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-32">Debit</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-32">Credit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, i) => (
              <tr key={i} className="align-top">
                <td className="px-3 py-2">
                  <Select
                    aria-label={`Account for line ${i + 1}`}
                    value={line.accountId}
                    onChange={(e) => setLine(i, { accountId: e.target.value })}
                  >
                    <option value="">Choose an account…</option>
                    {ACCOUNT_TYPES.map((type) => (
                      <optgroup key={type} label={ACCOUNT_TYPE_LABEL[type]}>
                        {(byType.get(type) ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  {lineProblems(i).map((p, n) => (
                    <p key={n} className="text-xs text-red-600 mt-1">
                      {p.message}
                    </p>
                  ))}
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label={`Description for line ${i + 1}`}
                    value={line.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    maxLength={300}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label={`Debit for line ${i + 1}`}
                    inputMode="decimal"
                    className="text-right"
                    value={line.debit}
                    onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label={`Credit for line ${i + 1}`}
                    inputMode="decimal"
                    className="text-right"
                    value={line.credit}
                    onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                  />
                </td>
                <td className="px-2 py-2">
                  {lines.length > 2 && (
                    <button
                      type="button"
                      aria-label={`Remove line ${i + 1}`}
                      className="text-muted-foreground hover:text-red-600 p-1"
                      onClick={() => setLines((prev) => prev.filter((_, n) => n !== i))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/30 border-t border-border">
            <tr>
              <td className="px-3 py-2" colSpan={2}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  <Plus className="w-3.5 h-3.5" /> Add line
                </Button>
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatPence(totals.debit)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatPence(totals.credit)}</td>
              <td />
            </tr>
            {totals.difference !== 0 && (
              <tr>
                <td className="px-3 pb-2 text-xs text-amber-700" colSpan={5}>
                  Out by {formatPence(Math.abs(totals.difference))} — a journal can be saved as a draft
                  while it is out, but not posted.
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <p className="text-sm text-red-700">{error}</p>
          {generalProblems.map((p, i) => (
            <p key={i} className="text-xs text-red-600 mt-1">
              {p.message}
            </p>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="outline" disabled={saving}>
          Save draft
        </Button>
        <Button type="button" onClick={() => submit(true)} disabled={saving}>
          {saving ? "Working…" : "Post"}
        </Button>
      </div>
    </form>
  );
}
