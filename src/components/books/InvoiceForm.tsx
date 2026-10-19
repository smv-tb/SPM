"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { clientFetch } from "@/lib/client-fetch";
import { formatPence, fromPence, toPence } from "@/lib/money";
import { calendarDateKey, toLedgerDate, ledgerDateKey } from "@/lib/accounting/dates";
import { describePaymentTerms, dueDateFrom, lineAmountPence, toMilli } from "@/lib/accounting/sales";
import { Plus, Trash2 } from "lucide-react";

export interface InvoiceCustomer {
  id: string;
  name: string;
  paymentTermsDays: number;
  billingAddress: string | null;
  shippingAddress: string | null;
  taxId: string | null;
}

export interface InvoiceProduct {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number;
  incomeAccountId: string | null;
}

export interface InvoiceLineValue {
  productId: string;
  code: string;
  name: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  incomeAccountId: string;
}

export interface ExistingInvoice {
  id: string;
  contactId: string;
  issueDate: string;
  /** Invoices only; a credit note has no terms. */
  paymentTermsDays?: number;
  /** Credit notes only: the invoice being corrected. */
  invoiceId?: string | null;
  reference: string | null;
  notes: string | null;
  lines: {
    productId: string | null;
    code: string | null;
    name: string;
    description: string | null;
    unit: string;
    quantity: string;
    unitPrice: number;
    incomeAccountId: string | null;
  }[];
}

/** The approved invoice a new credit note corrects. */
export interface CreditedInvoice {
  id: string;
  number: string | null;
  contactId: string;
  /** Still owed on it: crediting more leaves the rest as customer credit. */
  amountDue: number;
}

interface Props {
  customers: InvoiceCustomer[];
  products: InvoiceProduct[];
  invoice?: ExistingInvoice | null;
  /** The same line editor raises credit notes. Defaults to an invoice. */
  document?: "invoice" | "creditNote";
  /** Credit notes: the invoice it corrects, which fixes the customer. */
  creditFor?: CreditedInvoice | null;
  /** Lines to start a new document with, e.g. the invoice being credited. */
  initialLines?: ExistingInvoice["lines"];
  /** Approving allocates the number and posts the sale: Admin only. */
  canApprove: boolean;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

interface Problem {
  code: string;
  message: string;
  line?: number;
}

const emptyLine = (): InvoiceLineValue => ({
  productId: "",
  code: "",
  name: "",
  description: "",
  unit: "day",
  quantity: "1",
  unitPrice: "",
  incomeAccountId: "",
});

/** Pence for the running total; unparseable text reads as zero until submit says so. */
function safeAmount(line: InvoiceLineValue): number {
  try {
    return lineAmountPence(toMilli(line.quantity || "0"), toPence(line.unitPrice || "0"));
  } catch {
    return 0;
  }
}

function toLineValue(l: ExistingInvoice["lines"][number]): InvoiceLineValue {
  return {
    productId: l.productId ?? "",
    code: l.code ?? "",
    name: l.name,
    description: l.description ?? "",
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: fromPence(l.unitPrice),
    incomeAccountId: l.incomeAccountId ?? "",
  };
}

export function InvoiceForm({
  customers,
  products,
  invoice,
  document = "invoice",
  creditFor = null,
  initialLines,
  canApprove,
  onSaved,
  onCancel,
}: Props) {
  const isCredit = document === "creditNote";
  const endpoint = isCredit ? "/api/books/credit-notes" : "/api/books/invoices";
  const [contactId, setContactId] = useState(invoice?.contactId ?? creditFor?.contactId ?? "");
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? calendarDateKey());
  const [terms, setTerms] = useState(String(invoice?.paymentTermsDays ?? 0));
  const [reference, setReference] = useState(invoice?.reference ?? "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [lines, setLines] = useState<InvoiceLineValue[]>(
    (invoice?.lines ?? initialLines)?.map(toLineValue) ?? [emptyLine()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);

  const customer = customers.find((c) => c.id === contactId) ?? null;
  const termsDays = Number.isInteger(Number(terms)) && Number(terms) >= 0 ? Number(terms) : 0;
  const total = useMemo(() => lines.reduce((sum, line) => sum + safeAmount(line), 0), [lines]);

  const dueDate = useMemo(() => {
    try {
      return ledgerDateKey(dueDateFrom(toLedgerDate(issueDate), termsDays));
    } catch {
      return "";
    }
  }, [issueDate, termsDays]);

  function update(index: number, patch: Partial<InvoiceLineValue>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  /** Picking a catalogue item fills the line in; every field stays editable after. */
  function pickProduct(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      update(index, { productId: "" });
      return;
    }
    update(index, {
      productId,
      code: product.code,
      name: product.name,
      description: product.description ?? "",
      unit: product.unit,
      unitPrice: fromPence(product.unitPrice),
      incomeAccountId: product.incomeAccountId ?? "",
    });
  }

  function chooseCustomer(id: string) {
    setContactId(id);
    // Their default terms, unless this invoice already carries its own.
    const picked = customers.find((c) => c.id === id);
    if (picked && !invoice) setTerms(String(picked.paymentTermsDays));
  }

  async function submit(approve: boolean) {
    setBusy(true);
    setError("");
    setProblems([]);

    const body = {
      contactId,
      issueDate,
      ...(isCredit
        ? { invoiceId: invoice?.invoiceId ?? creditFor?.id ?? null }
        : { paymentTermsDays: termsDays }),
      reference: reference.trim() || null,
      notes: notes.trim() || null,
      lines: lines.map((line) => ({
        productId: line.productId || null,
        code: line.code.trim() || null,
        name: line.name.trim(),
        description: line.description.trim() || null,
        unit: line.unit.trim() || "item",
        quantity: line.quantity.trim() || "0",
        unitPrice: line.unitPrice.trim() || "0",
        incomeAccountId: line.incomeAccountId || null,
      })),
      approve,
    };

    const res = await clientFetch(invoice ? `${endpoint}/${invoice.id}` : endpoint, {
      method: invoice ? "PUT" : "POST",
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
    if (approve && invoice) {
      setBusy(true);
      const approved = await clientFetch(`${endpoint}/${invoice.id}/approve`, {
        method: "POST",
      });
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
          <FormLabel htmlFor="invoice-customer">Customer</FormLabel>
          <Select
            id="invoice-customer"
            value={contactId}
            // A correction goes to whoever the invoice billed.
            disabled={Boolean(creditFor || invoice?.invoiceId)}
            onChange={(e) => chooseCustomer(e.target.value)}
          >
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FormLabel htmlFor="invoice-date">Issue date</FormLabel>
          <Input
            id="invoice-date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </div>
        {!isCredit && (
          <div>
            <FormLabel htmlFor="invoice-terms">Payment terms (days)</FormLabel>
            <Input
              id="invoice-terms"
              type="number"
              min={0}
              max={365}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {describePaymentTerms(termsDays)}
              {termsDays > 0 && dueDate ? ` — due ${dueDate}` : ""}
            </p>
          </div>
        )}
      </div>

      {customer && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Billing address</p>
            <p className="whitespace-pre-line">{customer.billingAddress || "— none on file —"}</p>
            {customer.taxId && (
              <p className="mt-1 text-xs text-muted-foreground">Taxpayer ID {customer.taxId}</p>
            )}
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Shipping address</p>
            <p className="whitespace-pre-line">
              {customer.shippingAddress || customer.billingAddress || "— none on file —"}
            </p>
            {!customer.shippingAddress && customer.billingAddress && (
              <p className="mt-1 text-xs text-muted-foreground">Same as billing</p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="hidden md:grid grid-cols-12 gap-2 text-xs uppercase tracking-wider text-muted-foreground px-1">
          <span className="col-span-4">Item</span>
          <span className="col-span-2">Qty</span>
          <span className="col-span-2">Unit</span>
          <span className="col-span-2">Unit price</span>
          <span className="col-span-2 text-right">Amount</span>
        </div>

        {lines.map((line, index) => (
          <div key={index} className="rounded-lg border border-border p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
              <div className="md:col-span-4 space-y-2">
                <Select
                  aria-label={`Catalogue item for line ${index + 1}`}
                  value={line.productId}
                  onChange={(e) => pickProduct(index, e.target.value)}
                >
                  <option value="">Free text…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} {p.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Name for line ${index + 1}`}
                  placeholder="What you are charging for"
                  value={line.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Input
                  aria-label={`Quantity for line ${index + 1}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => update(index, { quantity: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Input
                  aria-label={`Unit for line ${index + 1}`}
                  value={line.unit}
                  onChange={(e) => update(index, { unit: e.target.value })}
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

            <Input
              aria-label={`Description for line ${index + 1}`}
              placeholder="Description (optional)"
              value={line.description}
              onChange={(e) => update(index, { description: e.target.value })}
            />

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
        <div className="space-y-3">
          <div>
            <FormLabel htmlFor="invoice-reference">Reference</FormLabel>
            <Input
              id="invoice-reference"
              placeholder="Their purchase order, a project name…"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div>
            <FormLabel htmlFor="invoice-notes">Notes</FormLabel>
            <Textarea
              id="invoice-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="rounded-lg border border-border p-4 space-y-1 text-sm self-start">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatPence(total)}</span>
          </div>
          <div className="flex justify-between font-semibold text-base">
            <span>{isCredit ? "Total credit" : "Total"}</span>
            <span className="tabular-nums">{formatPence(total)}</span>
          </div>
          {creditFor && (
            <p className="text-xs text-muted-foreground pt-1">
              {creditFor.number} still has {formatPence(creditFor.amountDue)} owing
              {total > creditFor.amountDue
                ? `; the other ${formatPence(total - creditFor.amountDue)} stays with the customer as credit.`
                : "; approving applies this credit to it."}
            </p>
          )}
          <p className="text-xs text-muted-foreground pt-1">
            No VAT: the company is not VAT registered.
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
