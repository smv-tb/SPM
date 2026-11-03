"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence, fromPence, toPence } from "@/lib/money";
import { calendarDateKey, ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { describePaymentTerms, dueDateFrom, lineAmountPence, toMilli } from "@/lib/accounting/sales";
import { Plus, Trash2 } from "lucide-react";

export interface BillSupplier {
  id: string;
  name: string;
  paymentTermsDays: number;
}

/** An account a bill line may be booked to (see `isBillAccount`). */
export interface BillAccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface BillLineValue {
  description: string;
  accountId: string;
  quantity: string;
  unitPrice: string;
}

export interface ExistingBill {
  id: string;
  contactId: string;
  supplierReference: string | null;
  issueDate: string;
  dueDate: string;
  notes: string | null;
  lines: { description: string; accountId: string | null; quantity: string; unitPrice: number }[];
}

interface Props {
  suppliers: BillSupplier[];
  accounts: BillAccountOption[];
  bill?: ExistingBill | null;
  /** Approving posts to the ledger: Admin only. */
  canApprove: boolean;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

interface Problem {
  code: string;
  message: string;
  line?: number;
}

const emptyLine = (): BillLineValue => ({ description: "", accountId: "", quantity: "1", unitPrice: "" });

/** Pence for the running total; unparseable text reads as zero until submit says so. */
function safeAmount(line: BillLineValue): number {
  try {
    return lineAmountPence(toMilli(line.quantity || "0"), toPence(line.unitPrice || "0"));
  } catch {
    return 0;
  }
}

function dueFrom(issueDate: string, terms: number): string {
  try {
    return ledgerDateKey(dueDateFrom(toLedgerDate(issueDate), terms));
  } catch {
    return issueDate;
  }
}

export function BillForm({ suppliers, accounts, bill, canApprove, onSaved, onCancel }: Props) {
  const [contactId, setContactId] = useState(bill?.contactId ?? "");
  const [reference, setReference] = useState(bill?.supplierReference ?? "");
  const [issueDate, setIssueDate] = useState(bill?.issueDate ?? calendarDateKey());
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? calendarDateKey());
  // Until someone types a due date, it follows the bill date and the supplier's terms.
  const [dueTouched, setDueTouched] = useState(Boolean(bill));
  const [notes, setNotes] = useState(bill?.notes ?? "");
  const [lines, setLines] = useState<BillLineValue[]>(
    bill?.lines.map((l) => ({
      description: l.description,
      accountId: l.accountId ?? "",
      quantity: l.quantity,
      unitPrice: fromPence(l.unitPrice),
    })) ?? [emptyLine()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);

  const supplier = suppliers.find((s) => s.id === contactId) ?? null;
  const total = useMemo(() => lines.reduce((sum, line) => sum + safeAmount(line), 0), [lines]);
  const expenses = accounts.filter((a) => a.type === "EXPENSE");
  const assets = accounts.filter((a) => a.type === "ASSET");

  function update(index: number, patch: Partial<BillLineValue>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function chooseSupplier(id: string) {
    setContactId(id);
    const picked = suppliers.find((s) => s.id === id);
    if (picked && !dueTouched) setDueDate(dueFrom(issueDate, picked.paymentTermsDays));
  }

  function chooseIssueDate(value: string) {
    setIssueDate(value);
    if (!dueTouched) setDueDate(dueFrom(value, supplier?.paymentTermsDays ?? 0));
  }

  async function submit(approve: boolean) {
    setBusy(true);
    setError("");
    setProblems([]);

    const body = {
      contactId,
      supplierReference: reference.trim() || null,
      issueDate,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
      lines: lines.map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId || null,
        quantity: line.quantity.trim() || "0",
        unitPrice: line.unitPrice.trim() || "0",
      })),
      approve,
    };

    const res = await clientFetch(bill ? `/api/books/bills/${bill.id}` : "/api/books/bills", {
      method: bill ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Request failed (${res.status})`);
      setProblems(Array.isArray(payload.problems) ? payload.problems : []);
      return;
    }
    const saved = await res.json();

    // POST can approve as it creates; PUT only saves, so an existing draft
    // takes the approve step separately.
    if (approve && bill) {
      setBusy(true);
      const approved = await clientFetch(`/api/books/bills/${bill.id}/approve`, { method: "POST" });
      setBusy(false);
      if (!approved.ok) {
        const payload = await approved.json().catch(() => ({}));
        setError(payload.error ?? `Could not approve (${approved.status})`);
        setProblems(Array.isArray(payload.problems) ? payload.problems : []);
        return;
      }
    }

    onSaved(saved.id);
  }

  const generalProblems = problems.filter((p) => p.line === undefined);
  const problemFor = (index: number) => problems.filter((p) => p.line === index + 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <FormLabel htmlFor="bill-supplier">Supplier</FormLabel>
          <Select id="bill-supplier" value={contactId} onChange={(e) => chooseSupplier(e.target.value)}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {supplier && (
            <p className="mt-1 text-xs text-muted-foreground">
              Usual terms: {describePaymentTerms(supplier.paymentTermsDays).toLowerCase()}
            </p>
          )}
        </div>
        <div className="md:col-span-2">
          <FormLabel htmlFor="bill-reference">Their invoice number</FormLabel>
          <Input
            id="bill-reference"
            placeholder="As printed on the supplier's invoice"
            maxLength={100}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <div>
          <FormLabel htmlFor="bill-date">Bill date</FormLabel>
          <Input id="bill-date" type="date" value={issueDate} onChange={(e) => chooseIssueDate(e.target.value)} />
        </div>
        <div>
          <FormLabel htmlFor="bill-due">Due date</FormLabel>
          <Input
            id="bill-due"
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueTouched(true);
              setDueDate(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="hidden md:grid grid-cols-12 gap-2 text-xs uppercase tracking-wider text-muted-foreground px-1">
          <span className="col-span-4">Description</span>
          <span className="col-span-3">Account</span>
          <span className="col-span-1">Qty</span>
          <span className="col-span-2">Unit price</span>
          <span className="col-span-2 text-right">Amount</span>
        </div>

        {lines.map((line, index) => (
          <div key={index} className="rounded-lg border border-border p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
              <div className="md:col-span-4">
                <Input
                  aria-label={`Description for line ${index + 1}`}
                  placeholder="What was bought"
                  maxLength={500}
                  value={line.description}
                  onChange={(e) => update(index, { description: e.target.value })}
                />
              </div>
              <div className="md:col-span-3">
                <Select
                  aria-label={`Account for line ${index + 1}`}
                  value={line.accountId}
                  onChange={(e) => update(index, { accountId: e.target.value })}
                >
                  <option value="">Choose an account…</option>
                  <optgroup label="Expenses">
                    {expenses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </optgroup>
                  {assets.length > 0 && (
                    <optgroup label="Assets">
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </div>
              <div className="md:col-span-1">
                <Input
                  aria-label={`Quantity for line ${index + 1}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => update(index, { quantity: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Input
                  aria-label={`Unit price for line ${index + 1}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={line.unitPrice}
                  onChange={(e) => update(index, { unitPrice: e.target.value })}
                />
              </div>
              <div className="md:col-span-2 flex items-center justify-between md:justify-end gap-2 pt-2">
                <span className="tabular-nums">{formatPence(safeAmount(line))}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {problemFor(index).map((p) => (
              <p key={p.code} className="text-sm text-red-600">
                {p.message}
              </p>
            ))}
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={() => setLines((c) => [...c, emptyLine()])}>
          <Plus className="w-3.5 h-3.5" /> Add line
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <FormLabel htmlFor="bill-notes">Notes</FormLabel>
          <Textarea id="bill-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="rounded-lg border border-border p-4 space-y-1 text-sm self-start">
          <div className="flex justify-between font-semibold text-base">
            <span>Total</span>
            <span className="tabular-nums">{formatPence(total)}</span>
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            Enter the bill total as charged: the company is not VAT registered, so VAT is part of the cost.
          </p>
        </div>
      </div>

      {generalProblems.map((p) => (
        <p key={p.code} className="text-sm text-red-600">
          {p.message}
        </p>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="outline" disabled={busy || !contactId} onClick={() => submit(false)}>
          Save draft
        </Button>
        {canApprove && (
          <Button disabled={busy || !contactId || total <= 0} onClick={() => submit(true)}>
            Approve
          </Button>
        )}
      </div>
    </div>
  );
}
