"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence, fromPence, toPence } from "@/lib/money";
import { calendarDateKey } from "@/lib/accounting/dates";
import type { BankAccountOption } from "@/lib/accounting/bank-accounts";

/** Pence for a typed amount, or null while it is not a valid one yet. */
function typedPence(value: string): number | null {
  try {
    return value.trim() ? toPence(value.trim()) : null;
  } catch {
    return null;
  }
}

function BankAccountField({
  accounts,
  value,
  onChange,
}: {
  accounts: BankAccountOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (accounts.length <= 1) return null;
  return (
    <div>
      <FormLabel htmlFor="payment-account">Bank account</FormLabel>
      <Select id="payment-account" value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {a.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

interface OpenStatementLine {
  id: string;
  date: string;
  amount: number;
  description: string;
  bankAccountName: string;
  ledgerAccountId: string;
}

/** The words, endpoints and request keys that differ between money in and money out. */
const SIDES = {
  in: {
    endpoint: "/api/books/payments",
    linesEndpoint: "/api/books/payments/statement-lines",
    allocationKey: "invoiceId",
    party: "Customer",
    choose: "Choose a customer…",
    titleFor: (label: string) => `Record payment for ${label}`,
    title: "Record a payment received",
    dateLabel: "Date received",
    extra: (over: string, label: string) =>
      `That is ${over} more than ${label} owes; the extra is kept as the customer's credit, to apply to another invoice or refund.`,
    onAccount: "Recorded on account; apply it to the customer's invoices from the payment.",
  },
  out: {
    endpoint: "/api/books/supplier-payments",
    linesEndpoint: "/api/books/supplier-payments/statement-lines",
    allocationKey: "billId",
    party: "Supplier",
    choose: "Choose a supplier…",
    titleFor: (label: string) => `Record payment of ${label}`,
    title: "Record a payment to a supplier",
    dateLabel: "Date paid",
    extra: (over: string, label: string) =>
      `That is ${over} more than ${label} owes; the extra is recorded as paid on account, to apply to another of their bills.`,
    onAccount: "Recorded on account; apply it to the supplier's bills from the payment.",
  },
} as const;

interface RecordPaymentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankAccounts: BankAccountOption[];
  /** Money in from a customer (the default), or out to a supplier. */
  side?: keyof typeof SIDES;
  /** Paying a known invoice or bill: the contact is fixed and the amount defaults to what is due. */
  invoice?: { id: string; number: string | null; contactId: string; amountDue: number } | null;
  /** Otherwise the contact is chosen; the money is held on account until allocated. */
  customers?: { id: string; name: string }[];
  onRecorded: (paymentId: string) => void;
}

/**
 * Records money received from a customer, or paid to a supplier. Against an
 * invoice or a bill, anything over what it owes is held on account — the
 * dialog says so before it is saved.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  bankAccounts,
  side = "in",
  invoice,
  customers = [],
  onRecorded,
}: RecordPaymentProps) {
  const text = SIDES[side];
  const [contactId, setContactId] = useState(invoice?.contactId ?? "");
  const [date, setDate] = useState(calendarDateKey());
  const [amount, setAmount] = useState(invoice ? fromPence(invoice.amountDue) : "");
  const [accountId, setAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<OpenStatementLine[]>([]);
  const [lineId, setLineId] = useState("");

  // Unreconciled lines from imported statements (money in, or money out shown
  // as what was paid); best-effort, the dialog works without them.
  useEffect(() => {
    if (!open) return;
    let live = true;
    clientFetch(text.linesEndpoint)
      .then((res) => (res.ok ? res.json() : { lines: [] }))
      .then((data) => live && setLines(data.lines ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, text.linesEndpoint]);

  const line = lines.find((l) => l.id === lineId) ?? null;

  function chooseLine(id: string) {
    setLineId(id);
    const picked = lines.find((l) => l.id === id);
    if (!picked) return;
    // The bank's figures win: the books have to match the statement to the penny.
    setDate(picked.date);
    setAmount(fromPence(picked.amount));
    setAccountId(picked.ledgerAccountId);
    setReference((current) => current || picked.description.slice(0, 100));
  }

  // Closest to what is owed first, so the likely line is at the top.
  const target = invoice?.amountDue ?? null;
  const sortedLines =
    target === null
      ? lines
      : [...lines].sort((a, b) => Math.abs(a.amount - target) - Math.abs(b.amount - target));

  const pence = typedPence(amount);
  const over = invoice && pence !== null ? pence - invoice.amountDue : 0;
  const label = invoice?.number ?? (side === "in" ? "the invoice" : "the bill");

  async function save() {
    setBusy(true);
    setError("");
    const res = await clientFetch(text.endpoint, {
      method: "POST",
      body: JSON.stringify({
        contactId,
        date,
        amount: amount.trim(),
        bankAccountId: accountId || null,
        reference: reference.trim() || null,
        statementLineId: lineId || null,
        allocations: invoice ? [{ [text.allocationKey]: invoice.id }] : [],
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Could not record the payment (${res.status})`);
      return;
    }
    const saved = await res.json();
    onOpenChange(false);
    onRecorded(saved.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{invoice ? text.titleFor(label) : text.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!invoice && (
            <div>
              <FormLabel htmlFor="payment-customer">{text.party}</FormLabel>
              <Select id="payment-customer" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{text.choose}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {lines.length > 0 && (
            <div>
              <FormLabel htmlFor="payment-line">Bank statement line</FormLabel>
              <Select id="payment-line" value={lineId} onChange={(e) => chooseLine(e.target.value)}>
                <option value="">Not on a statement yet</option>
                {sortedLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {`${l.date} · ${formatPence(l.amount)} · ${l.description.slice(0, 50)}${
                      target !== null && l.amount === target ? " · exact match" : ""
                    }`}
                  </option>
                ))}
              </Select>
              {line && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Date, amount and account come from the statement, and the line is reconciled when you save.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FormLabel htmlFor="payment-date">{text.dateLabel}</FormLabel>
              <Input
                id="payment-date"
                type="date"
                value={date}
                disabled={!!line}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <FormLabel htmlFor="payment-amount">Amount</FormLabel>
              <Input
                id="payment-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={!!line}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          {!line && <BankAccountField accounts={bankAccounts} value={accountId} onChange={setAccountId} />}
          <div>
            <FormLabel htmlFor="payment-reference">Reference</FormLabel>
            <Input
              id="payment-reference"
              placeholder="What the bank statement shows"
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          {invoice && pence !== null && over > 0 && (
            <p className="text-sm text-amber-700">{text.extra(formatPence(over), label)}</p>
          )}
          {invoice && pence !== null && over < 0 && (
            <p className="text-sm text-muted-foreground">
              A part payment: {formatPence(-over)} will still be owed.
            </p>
          )}
          {!invoice && <p className="text-sm text-muted-foreground">{text.onAccount}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !contactId || pence === null || pence <= 0} onClick={save}>
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RefundProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankAccounts: BankAccountOption[];
  source: { creditNoteId: string } | { paymentId: string };
  /** What is left to refund, in pence. */
  remaining: number;
  /** "credit note CN002", "this payment". */
  label: string;
  onRecorded: (refundId: string) => void;
}

/** Pays unused credit back to the customer. */
export function RefundDialog({ open, onOpenChange, bankAccounts, source, remaining, label, onRecorded }: RefundProps) {
  const [date, setDate] = useState(calendarDateKey());
  const [amount, setAmount] = useState(fromPence(remaining));
  const [accountId, setAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pence = typedPence(amount);

  async function save() {
    setBusy(true);
    setError("");
    const res = await clientFetch("/api/books/refunds", {
      method: "POST",
      body: JSON.stringify({
        source,
        date,
        amount: amount.trim(),
        bankAccountId: accountId || null,
        reference: reference.trim() || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Could not record the refund (${res.status})`);
      return;
    }
    const saved = await res.json();
    onOpenChange(false);
    onRecorded(saved.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {formatPence(remaining)} is unused. Record the refund once the money has left the bank;
            it posts straight away.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FormLabel htmlFor="refund-date">Date paid</FormLabel>
              <Input id="refund-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <FormLabel htmlFor="refund-amount">Amount</FormLabel>
              <Input
                id="refund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <BankAccountField accounts={bankAccounts} value={accountId} onChange={setAccountId} />
          <div>
            <FormLabel htmlFor="refund-reference">Reference</FormLabel>
            <Input
              id="refund-reference"
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || pence === null || pence <= 0 || pence > remaining} onClick={save}>
            Record refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
