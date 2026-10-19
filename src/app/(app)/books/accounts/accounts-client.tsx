"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence } from "@/lib/money";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  CODE_RANGES,
  NORMAL_BALANCE,
  type AccountType,
} from "@/lib/accounting/chart";
import { Plus } from "lucide-react";

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  description: string | null;
  isSystem: boolean;
  isArchived: boolean;
  /** Net posted balance in pence, debit positive. */
  balance: number;
  inUse: boolean;
}

interface Props {
  accounts: AccountRow[];
  canPost: boolean;
  canManage: boolean;
}

/** Shows a balance on its natural side: a credit-normal account in credit reads as positive. */
function displayBalance(account: AccountRow): string {
  if (account.balance === 0) return "—";
  const natural = NORMAL_BALANCE[account.type] === "DEBIT" ? account.balance : -account.balance;
  return natural < 0 ? `(${formatPence(-natural)})` : formatPence(natural);
}

export function AccountsClient({ accounts, canPost, canManage }: Props) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "EXPENSE" as AccountType });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const grouped = useMemo(() => {
    const visible = accounts.filter((a) => showArchived || !a.isArchived);
    return ACCOUNT_TYPES.map((type) => ({ type, accounts: visible.filter((a) => a.type === type) }));
  }, [accounts, showArchived]);

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    const res = await clientFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Request failed (${res.status})`);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <Topbar
        title="Chart of accounts"
        subtitle="Where every posting is recorded"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Accounts", href: "/books/accounts" },
        ]}
        actions={
          canPost ? (
            <Button
              size="sm"
              onClick={() => {
                setForm({ code: "", name: "", type: "EXPENSE" });
                setError("");
                setCreating(true);
              }}
            >
              <Plus className="w-3.5 h-3.5" /> Add account
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived accounts
        </label>

        {grouped.map(({ type, accounts: rows }) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle>{ACCOUNT_TYPE_LABEL[type]}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {rows.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">No accounts.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {rows.map((account) => (
                      <tr key={account.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3 w-20 tabular-nums text-muted-foreground">{account.code}</td>
                        <td className="px-3 py-3">
                          <Link href={`/books/accounts/${account.id}`} className="font-medium hover:text-primary">
                            {account.name}
                          </Link>
                          {account.isSystem && (
                            <Badge variant="neutral" size="sm" className="ml-2">
                              System
                            </Badge>
                          )}
                          {account.isArchived && (
                            <Badge variant="warning" size="sm" className="ml-2">
                              Archived
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-3 w-40 text-right tabular-nums">{displayBalance(account)}</td>
                        <td className="px-5 py-3 w-24 text-right">
                          {canPost && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setError("");
                                setEditing(account);
                              }}
                            >
                              Edit
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        ))}
      </main>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <FormLabel htmlFor="account-type">Type</FormLabel>
              <Select
                id="account-type"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AccountType }))}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABEL[t]} ({CODE_RANGES[t][0]}–{CODE_RANGES[t][1]})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FormLabel htmlFor="account-code">Code</FormLabel>
              <Input
                id="account-code"
                inputMode="numeric"
                maxLength={4}
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder={String(CODE_RANGES[form.type][0])}
              />
            </div>
            <div>
              <FormLabel htmlFor="account-name">Name</FormLabel>
              <Input
                id="account-name"
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await send("/api/books/accounts", "POST", form)) setCreating(false);
              }}
            >
              Add account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {editing.code} {editing.name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <FormLabel htmlFor="edit-name">Name</FormLabel>
                  <Input
                    id="edit-name"
                    maxLength={120}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                {editing.isSystem && (
                  <p className="text-xs text-muted-foreground">
                    A system account is used by automated postings. It can be renamed, but not archived or recoded.
                  </p>
                )}
                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
              <DialogFooter className="justify-between">
                <div className="flex gap-2">
                  {canManage && !editing.isSystem && !editing.inUse && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        if (!await confirmDialog(`Delete ${editing.code} ${editing.name}?`)) return;
                        if (await send(`/api/books/accounts/${editing.id}`, "DELETE")) setEditing(null);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                  {canManage && !editing.isSystem && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await send(`/api/books/accounts/${editing.id}`, "PATCH", {
                            isArchived: !editing.isArchived,
                          })
                        ) {
                          setEditing(null);
                        }
                      }}
                    >
                      {editing.isArchived ? "Restore" : "Archive"}
                    </Button>
                  )}
                </div>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (await send(`/api/books/accounts/${editing.id}`, "PATCH", { name: editing.name })) {
                      setEditing(null);
                    }
                  }}
                >
                  Save
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
