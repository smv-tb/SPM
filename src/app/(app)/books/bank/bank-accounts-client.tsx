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
import { CreditCard, Landmark, Plus } from "lucide-react";

type Kind = "BANK" | "CREDIT_CARD";

interface Props {
  accounts: SerializedBankAccount[];
  /** 12xx ledger accounts with no bank account yet. */
  ledgerAccounts: BankAccountOption[];
  /** 20xx ledger accounts with no credit card yet. */
  cardLedgerAccounts: BankAccountOption[];
  canSetUp: boolean;
}

export function BankAccountsClient({ accounts, ledgerAccounts, cardLedgerAccounts, canSetUp }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState<Kind | null>(null);
  const [name, setName] = useState("");
  const [ledgerAccountId, setLedgerAccountId] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [cardLastFour, setCardLastFour] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canAddBank = canSetUp && ledgerAccounts.length > 0;
  const canAddCard = canSetUp && cardLedgerAccounts.length > 0;
  const options = adding === "CREDIT_CARD" ? cardLedgerAccounts : ledgerAccounts;

  function start(kind: Kind) {
    setName(kind === "CREDIT_CARD" ? "Company credit card" : "Lloyds business account");
    setLedgerAccountId((kind === "CREDIT_CARD" ? cardLedgerAccounts : ledgerAccounts)[0]?.id ?? "");
    setSortCode("");
    setAccountNumber("");
    setCardLastFour("");
    setError("");
    setAdding(kind);
  }

  async function add() {
    setBusy(true);
    setError("");
    const res = await clientFetch("/api/books/bank-accounts", {
      method: "POST",
      body: JSON.stringify(
        adding === "CREDIT_CARD"
          ? { kind: "CREDIT_CARD", name, ledgerAccountId, cardLastFour }
          : { name, ledgerAccountId, sortCode, accountNumber }
      ),
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
    setAdding(null);
    router.push(`/books/bank/${saved.id}`);
  }

  return (
    <>
      <Topbar
        title="Bank accounts and cards"
        subtitle="Statements as the bank and the card provider have them, beside the books"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Bank", href: "/books/bank" },
        ]}
        actions={
          canAddBank || canAddCard ? (
            <div className="flex gap-2">
              {canAddCard && (
                <Button size="sm" variant="outline" onClick={() => start("CREDIT_CARD")}>
                  <CreditCard className="w-3.5 h-3.5" /> Add credit card
                </Button>
              )}
              {canAddBank && (
                <Button size="sm" onClick={() => start("BANK")}>
                  <Plus className="w-3.5 h-3.5" /> Add bank account
                </Button>
              )}
            </div>
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
                description="Add the Lloyds business account, or a company credit card, to import its statements."
                actionLabel={canAddBank ? "Add bank account" : undefined}
                onAction={canAddBank ? () => start("BANK") : undefined}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {accounts.map((a) => {
              // A card's balance is held negative while money is owed; shown as what is owed.
              const isCard = a.kind === "CREDIT_CARD";
              const shown = (pence: number) => formatPence(isCard && pence !== 0 ? -pence : pence);
              return (
              <Link key={a.id} href={`/books/bank/${a.id}`}>
                <Card className="hover:border-primary transition-colors">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{a.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {a.details} · books to {a.ledgerAccountCode} {a.ledgerAccountName}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {isCard && <Badge variant="neutral">Credit card</Badge>}
                        {a.isArchived && <Badge variant="neutral">Archived</Badge>}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">
                          {isCard ? "Owed (statement)" : "Statement"}
                        </p>
                        <p className="tabular-nums font-medium">
                          {a.statementBalance !== null && a.statementBalance !== undefined
                            ? shown(a.statementBalance)
                            : "—"}
                        </p>
                        {a.statementDate && <p className="text-xs text-muted-foreground">{formatDate(a.statementDate)}</p>}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">
                          {isCard ? "Owed (books)" : "Books"}
                        </p>
                        <p className="tabular-nums font-medium">{shown(a.booksBalance ?? 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">To reconcile</p>
                        <p className="tabular-nums font-medium">{a.unreconciled ?? 0} lines</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={adding !== null} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{adding === "CREDIT_CARD" ? "Add a company credit card" : "Add a bank account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <FormLabel htmlFor="bank-name">Name</FormLabel>
              <Input id="bank-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <FormLabel htmlFor="bank-ledger">Books to</FormLabel>
              <Select id="bank-ledger" value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)}>
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            </div>
            {adding === "CREDIT_CARD" ? (
              <>
                <div>
                  <FormLabel htmlFor="card-last-four">Last four digits of the card</FormLabel>
                  <Input
                    id="card-last-four"
                    inputMode="numeric"
                    maxLength={4}
                    className="w-32"
                    value={cardLastFour}
                    onChange={(e) => setCardLastFour(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Only the last four digits, to tell cards apart: the full card number is never stored. What is
                  owed on the card shows in the books as a liability.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(null)} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || !name.trim() || !ledgerAccountId} onClick={add}>
              {adding === "CREDIT_CARD" ? "Add card" : "Add account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
