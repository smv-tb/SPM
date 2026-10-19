"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { SerializedBankAccount } from "@/lib/accounting/serialize";
import {
  DATE_FORMATS,
  FIELD_LABEL,
  NUMBER_FORMATS,
  REQUIRED_FIELDS,
  STATEMENT_FIELDS,
  type ImportProfile,
  type StatementField,
} from "@/lib/accounting/statement-import";
import type { StatementPreview } from "@/lib/accounting/statements";

/** How many preview rows to draw; the counts above always cover the whole file. */
const SHOWN = 300;

export function StatementImportClient({ account }: { account: SerializedBankAccount }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [profile, setProfile] = useState<ImportProfile | null>(null);
  const [allowBreaks, setAllowBreaks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function form(f: File, p: ImportProfile | null, extra: Record<string, string> = {}) {
    const body = new FormData();
    body.set("file", f);
    if (p) body.set("profile", JSON.stringify(p));
    for (const [k, v] of Object.entries(extra)) body.set(k, v);
    return body;
  }

  async function check(f: File, p: ImportProfile | null) {
    setBusy(true);
    setError("");
    const res = await clientFetch(`/api/books/bank-accounts/${account.id}/statements/preview`, {
      method: "POST",
      body: form(f, p),
    });
    setBusy(false);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPreview(null);
      setError(payload.error ?? `Could not read the file (${res.status})`);
      return;
    }
    setPreview(payload);
    setProfile(payload.profile);
    setAllowBreaks(false);
  }

  async function commit() {
    if (!file || !profile) return;
    setBusy(true);
    setError("");
    const res = await clientFetch(`/api/books/bank-accounts/${account.id}/statements`, {
      method: "POST",
      body: form(file, profile, allowBreaks ? { allowBalanceBreaks: "true" } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Could not import (${res.status})`);
      return;
    }
    router.push(`/books/bank/${account.id}`);
    router.refresh();
  }

  const setColumn = (field: StatementField, value: string) =>
    profile && setProfile({ ...profile, columns: { ...profile.columns, [field]: value || null } });

  const breaks = preview?.balances.breaks ?? [];
  const canImport =
    preview !== null &&
    preview.columnProblems.length === 0 &&
    preview.counts.invalid === 0 &&
    preview.counts.toImport > 0 &&
    (breaks.length === 0 || allowBreaks);

  return (
    <>
      <Topbar
        title="Import a statement"
        subtitle={`${account.name} · ${account.sortCode} · ${account.accountNumberMasked}`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Bank", href: "/books/bank" },
          { label: account.name, href: `/books/bank/${account.id}` },
          { label: "Import", href: `/books/bank/${account.id}/import` },
        ]}
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <Card>
          <CardContent className="p-5 space-y-2">
            <FormLabel htmlFor="statement-file">Statement file (CSV)</FormLabel>
            <Input
              id="statement-file"
              type="file"
              accept=".csv,.txt,text/csv"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                setPreview(null);
                if (chosen) void check(chosen, null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              In Lloyds online banking, export the statement as CSV. Nothing is saved until you press Import;
              lines already imported are recognised and skipped.
            </p>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {busy && <p className="text-sm text-muted-foreground">Reading the file…</p>}

        {preview && profile && file && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>How to read this file</CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {STATEMENT_FIELDS.map((field) => (
                    <div key={field}>
                      <FormLabel htmlFor={`col-${field}`}>
                        {FIELD_LABEL[field]}
                        {REQUIRED_FIELDS.includes(field) ? "" : " (optional)"}
                      </FormLabel>
                      <Select
                        id={`col-${field}`}
                        value={profile.columns[field] ?? ""}
                        onChange={(e) => setColumn(field, e.target.value)}
                      >
                        <option value="">— not in this file —</option>
                        {preview.header.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                  <div>
                    <FormLabel htmlFor="date-format">Date format</FormLabel>
                    <Select
                      id="date-format"
                      value={profile.dateFormat}
                      onChange={(e) => setProfile({ ...profile, dateFormat: e.target.value as ImportProfile["dateFormat"] })}
                    >
                      {DATE_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <FormLabel htmlFor="number-format">Numbers</FormLabel>
                    <Select
                      id="number-format"
                      value={profile.numberFormat}
                      onChange={(e) =>
                        setProfile({ ...profile, numberFormat: e.target.value as ImportProfile["numberFormat"] })
                      }
                    >
                      {NUMBER_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {f === "UK" ? "UK — 1,234.56" : "EU — 1.234,56"}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                {preview.columnProblems.map((p) => (
                  <p key={p.field} className="text-sm text-red-600">
                    {p.message}
                  </p>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {preview.encoding === "utf-8" ? "UTF-8" : "Windows-1252"} text,{" "}
                    {preview.delimiter === "\t" ? "tab" : preview.delimiter === ";" ? "semicolon" : "comma"}-separated.
                    These settings are remembered for this account after a successful import.
                  </p>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => check(file, profile)}>
                    Check again
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5 space-y-2 text-sm">
                <p>
                  <strong>{preview.counts.total}</strong> lines
                  {preview.firstDate && preview.lastDate
                    ? `, ${formatDate(preview.firstDate)} to ${formatDate(preview.lastDate)}`
                    : ""}
                  : <strong>{preview.counts.toImport}</strong> to import
                  {preview.counts.duplicates > 0 && <>, {preview.counts.duplicates} already imported</>}
                  {preview.counts.invalid > 0 && (
                    <span className="text-red-600">, {preview.counts.invalid} with errors</span>
                  )}
                  .
                </p>
                {preview.balances.opening !== null && breaks.length === 0 && (
                  <p className="text-emerald-700">
                    The running balance follows on every line: {formatPence(preview.balances.opening)} to{" "}
                    {formatPence(preview.balances.closing ?? 0)}.
                  </p>
                )}
                {breaks.length > 0 && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-800 space-y-2">
                    <p>
                      The running balance does not follow on {breaks.length} line{breaks.length === 1 ? "" : "s"} (first at row{" "}
                      {breaks[0].row}: expected {formatPence(breaks[0].expected)}, the file says{" "}
                      {formatPence(breaks[0].stated)}). A line may be missing from the export.
                    </p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allowBreaks} onChange={(e) => setAllowBreaks(e.target.checked)} />
                      Import anyway (recorded in the audit log)
                    </label>
                  </div>
                )}
                {preview.continuity && !preview.continuity.follows && (
                  <p className="text-amber-700">
                    This file does not pick up from the statement already held ({formatPence(preview.continuity.previousBalance)}{" "}
                    on {formatDate(preview.continuity.previousDate)}): there may be a gap between the two exports.
                  </p>
                )}
                {preview.continuity?.follows && (
                  <p className="text-muted-foreground">Carries on from the statement already held.</p>
                )}
              </CardContent>
            </Card>

            {preview.lines.length > 0 && (
              <Card>
                <CardContent className="px-0 py-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-5 py-2 text-left font-semibold">Row</th>
                        <th className="px-3 py-2 text-left font-semibold">Date</th>
                        <th className="px-3 py-2 text-left font-semibold">Type</th>
                        <th className="px-3 py-2 text-left font-semibold">Description</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-right font-semibold">Balance</th>
                        <th className="px-5 py-2 text-left font-semibold" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.lines.slice(0, SHOWN).map((l) => (
                        <tr key={l.row} className={l.duplicate ? "text-muted-foreground" : ""}>
                          <td className="px-5 py-2 tabular-nums">{l.row}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{l.date ? formatDate(l.date) : "—"}</td>
                          <td className="px-3 py-2">{l.type ?? ""}</td>
                          <td className="px-3 py-2">
                            {l.description}
                            {l.errors.map((e) => (
                              <span key={e} className="block text-xs text-red-600">
                                {e}
                              </span>
                            ))}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.amount === null ? "" : formatPence(l.amount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.balance === null ? "" : formatPence(l.balance)}</td>
                          <td className="px-5 py-2">
                            {l.errors.length > 0 ? (
                              <Badge variant="danger" size="sm">Error</Badge>
                            ) : l.duplicate ? (
                              <Badge variant="neutral" size="sm">Already imported</Badge>
                            ) : (
                              <Badge variant="success" size="sm">New</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.lines.length > SHOWN && (
                    <p className="px-5 py-3 text-xs text-muted-foreground">
                      Showing the first {SHOWN} of {preview.lines.length} lines; the counts above cover all of them.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => router.push(`/books/bank/${account.id}`)} disabled={busy}>
                Cancel
              </Button>
              <Button disabled={busy || !canImport} onClick={commit}>
                Import {preview.counts.toImport} line{preview.counts.toImport === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
