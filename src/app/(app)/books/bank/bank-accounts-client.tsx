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
import { FormLabel } from "@/components/ui/form-label";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { SerializedBankAccount } from "@/lib/accounting/serialize";
import type { BankAccountOption } from "@/lib/accounting/bank-accounts";
import { Landmark, Plus } from "lucide-react";

interface Props {
  accounts: SerializedBankAccount[];
  ledgerAccounts: BankAccountOption[];
  canSetUp: boolean;
}

export function BankAccountsClient({ accounts, ledgerAccounts, canSetUp }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("Lloyds business account");
  const [ledgerAccountId, setLedgerAccountId] = useState(ledgerAccounts[0]?.id ?? "");
  const [sortCode, setSortCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    setBusy(true);
    setError("");
    const res = await clientFetch("/api/books/bank-accounts", {
      method: "POST",
      body: JSON.stringify({ name, ledgerAccountId, sortCode, accountNumber }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const fieldErrors = payload.details?.fieldErrors as Record<string, string[]> | undefined;
      setError(payload.error === "Invalid request data" && fieldErrors
        ? Object.values(fieldErrors).flat()[0] ?? payload.error
        : payload.error ?? `Could not add the account (${res.status})`);
      return;
    }
    const saved = await res.json();
    setAdding(false);
    router.push(`/books/bank/${saved.id}`);
  }

  return (
    <>
      <Topbar
        title="Bank accounts"
        subtitle="Statements as the bank has them, beside the books"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Bank", href: "/books/bank" },
        ]}
        actions={
          canSetUp && ledgerAccounts.length > 0 ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="w-3.5 h-3.5" /> Add bank account
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-4">
        {accounts.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Landmark}
                title="No bank accounts yet"
                description="Add the Lloyds business account to import its statements."
                actionLabel={canSetUp && ledgerAccounts.length > 0 ? "Add bank account" : undefined}
                onAction={canSetUp && ledgerAccounts.length > 0 ? () => setAdding(true) : undefined}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {accounts.map((a) => (
              <Link key={a.id} href={`/books/bank/${a.id}`}>
                <Card className="hover:border-primary transition-colors">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{a.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {a.sortCode} · {a.accountNumberMasked} · books to {a.ledgerAccountCode} {a.ledgerAccountName}
                        </p>
                      </div>
                      {a.isArchived && <Badge variant="neutral">Archived</Badge>}
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Statement</p>
                        <p className="tabular-nums font-medium">
                          {a.statementBalance !== null && a.statementBalance !== undefined
                            ? formatPence(a.statementBalance)
                            : "—"}
                        </p>
                        {a.statementDate && <p className="text-xs text-muted-foreground">{formatDate(a.statementDate)}</p>}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Books</p>
                        <p className="tabular-nums font-medium">{formatPence(a.booksBalance ?? 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">To reconcile</p>
                        <p className="tabular-nums font-medium">{a.unreconciled ?? 0} lines</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a bank account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <FormLabel htmlFor="bank-name">Name</FormLabel>
              <Input id="bank-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <FormLabel htmlFor="bank-ledger">Books to</FormLabel>
              <Select id="bank-ledger" value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)}>
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FormLabel htmlFor="bank-sort-code">Sort code</FormLabel>
                <Input id="bank-sort-code" placeholder="30-99-50" value={sortCode} onChange={(e) => setSortCode(e.target.value)} />
              </div>
              <div>
                <FormLabel htmlFor="bank-account-number">Account number</FormLabel>
                <Input
                  id="bank-account-number"
                  inputMode="numeric"
                  maxLength={8}
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Every statement line is checked against these, so a file for another account is refused.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || !name.trim() || !ledgerAccountId} onClick={add}>
              Add account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
