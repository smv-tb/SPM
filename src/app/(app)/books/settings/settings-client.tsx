"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { FormLabel } from "@/components/ui/form-label";
import { clientFetch } from "@/lib/client-fetch";
import { formatDate } from "@/lib/utils";

interface Settings {
  legalName: string;
  companyNumber: string;
  vatNumber: string;
  vatRegistered: boolean;
  yearStartMonth: number;
  yearStartDay: number;
  lockDate: string;
  // Printed on invoices, and used to number them.
  registeredAddress: string;
  placeOfRegistration: string;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  invoiceNumberPad: number;
  creditNotePrefix: string;
  nextCreditNoteNumber: number;
  requireSecondApprover: boolean;
}

interface Props {
  settings: Settings;
  canEdit: boolean;
  canLock: boolean;
  canReopen: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function BooksSettingsClient({ settings, canEdit, canLock, canReopen }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [lockDate, setLockDate] = useState(settings.lockDate);
  const [secondApprover, setSecondApprover] = useState(settings.requireSecondApprover);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Clearing the lock or moving it earlier re-opens periods treated as final.
  const reopening = Boolean(settings.lockDate) && (!lockDate || lockDate < settings.lockDate);
  const lockAllowed = reopening ? canReopen : canLock;

  async function send(path: string, body: unknown, success: string) {
    setBusy(true);
    setMessage(null);
    const res = await clientFetch(path, { method: "PUT", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setMessage({ tone: "error", text: payload.error ?? `Could not save (${res.status})` });
      return;
    }
    setMessage({ tone: "ok", text: success });
    setReason("");
    router.refresh();
  }

  return (
    <>
      <Topbar
        title="Books settings"
        subtitle="Company details, financial year and lock date"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Settings", href: "/books/settings" },
        ]}
      />

      <main className="flex-1 overflow-auto p-6 space-y-5 max-w-3xl">
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

        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div>
              <FormLabel htmlFor="legalName">Legal name</FormLabel>
              <Input
                id="legalName"
                value={form.legalName}
                disabled={!canEdit}
                maxLength={200}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FormLabel htmlFor="companyNumber">Company number</FormLabel>
                <Input
                  id="companyNumber"
                  value={form.companyNumber}
                  disabled={!canEdit}
                  maxLength={20}
                  onChange={(e) => setForm({ ...form, companyNumber: e.target.value })}
                />
              </div>
              <div>
                <FormLabel htmlFor="vatNumber">VAT number</FormLabel>
                <Input
                  id="vatNumber"
                  value={form.vatNumber}
                  disabled={!canEdit || !form.vatRegistered}
                  maxLength={20}
                  onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.vatRegistered}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, vatRegistered: e.target.checked })}
              />
              VAT registered
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FormLabel htmlFor="yearStartMonth">Financial year starts — month</FormLabel>
                <Select
                  id="yearStartMonth"
                  value={form.yearStartMonth}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, yearStartMonth: Number(e.target.value) })}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FormLabel htmlFor="yearStartDay">Day</FormLabel>
                <Select
                  id="yearStartDay"
                  value={form.yearStartDay}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, yearStartDay: Number(e.target.value) })}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {canEdit ? (
              <div className="flex justify-end">
                <Button
                  disabled={busy}
                  onClick={() =>
                    send(
                      "/api/books/settings",
                      {
                        legalName: form.legalName,
                        companyNumber: form.companyNumber.trim() || null,
                        vatNumber: form.vatRegistered ? form.vatNumber.trim() || null : null,
                        vatRegistered: form.vatRegistered,
                        yearStartMonth: form.yearStartMonth,
                        yearStartDay: form.yearStartDay,
                      },
                      "Company settings saved."
                    )
                  }
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Only an Admin can change these.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoicing</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4 text-sm">
            <p className="text-muted-foreground">
              What every invoice prints, and the sequence it is numbered from. The next invoice
              approved will be{" "}
              <strong>
                {form.invoicePrefix}
                {String(form.nextInvoiceNumber).padStart(Math.max(1, form.invoiceNumberPad), "0")}
              </strong>
              , and the next credit note{" "}
              <strong>
                {form.creditNotePrefix}
                {String(form.nextCreditNoteNumber).padStart(Math.max(1, form.invoiceNumberPad), "0")}
              </strong>
              .
            </p>
            <div>
              <FormLabel htmlFor="registeredAddress">Registered address</FormLabel>
              <Textarea
                id="registeredAddress"
                rows={3}
                disabled={!canEdit}
                value={form.registeredAddress}
                onChange={(e) => setForm({ ...form, registeredAddress: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FormLabel htmlFor="placeOfRegistration">Place of registration</FormLabel>
                <Input
                  id="placeOfRegistration"
                  placeholder="England and Wales"
                  disabled={!canEdit}
                  value={form.placeOfRegistration}
                  onChange={(e) => setForm({ ...form, placeOfRegistration: e.target.value })}
                />
              </div>
              <div>
                <FormLabel htmlFor="bankAccountName">Account name</FormLabel>
                <Input
                  id="bankAccountName"
                  disabled={!canEdit}
                  value={form.bankAccountName}
                  onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
                />
              </div>
              <div>
                <FormLabel htmlFor="bankSortCode">Sort code</FormLabel>
                <Input
                  id="bankSortCode"
                  placeholder="00-00-00"
                  disabled={!canEdit}
                  value={form.bankSortCode}
                  onChange={(e) => setForm({ ...form, bankSortCode: e.target.value })}
                />
              </div>
              <div>
                <FormLabel htmlFor="bankAccountNumber">Account number</FormLabel>
                <Input
                  id="bankAccountNumber"
                  disabled={!canEdit}
                  value={form.bankAccountNumber}
                  onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                />
              </div>
              <div>
                <FormLabel htmlFor="invoicePrefix">Invoice prefix</FormLabel>
                <Input
                  id="invoicePrefix"
                  maxLength={10}
                  disabled={!canEdit}
                  value={form.invoicePrefix}
                  onChange={(e) =>
                    setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div>
                <FormLabel htmlFor="nextInvoiceNumber">Next number</FormLabel>
                <Input
                  id="nextInvoiceNumber"
                  type="number"
                  min={1}
                  disabled={!canEdit}
                  value={form.nextInvoiceNumber}
                  onChange={(e) =>
                    setForm({ ...form, nextInvoiceNumber: Number(e.target.value) || 1 })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Numbers are allocated at approval and never reused, so moving this forward
                  leaves a gap on purpose; moving it back will collide with an issued invoice.
                </p>
              </div>
              <div>
                <FormLabel htmlFor="creditNotePrefix">Credit note prefix</FormLabel>
                <Input
                  id="creditNotePrefix"
                  maxLength={10}
                  disabled={!canEdit}
                  value={form.creditNotePrefix}
                  onChange={(e) =>
                    setForm({ ...form, creditNotePrefix: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div>
                <FormLabel htmlFor="nextCreditNoteNumber">Next credit note number</FormLabel>
                <Input
                  id="nextCreditNoteNumber"
                  type="number"
                  min={1}
                  disabled={!canEdit}
                  value={form.nextCreditNoteNumber}
                  onChange={(e) =>
                    setForm({ ...form, nextCreditNoteNumber: Number(e.target.value) || 1 })
                  }
                />
              </div>
            </div>
            {canEdit ? (
              <div className="flex justify-end">
                <Button
                  disabled={busy}
                  onClick={() =>
                    send(
                      "/api/books/settings",
                      {
                        registeredAddress: form.registeredAddress.trim() || null,
                        placeOfRegistration: form.placeOfRegistration.trim() || null,
                        bankAccountName: form.bankAccountName.trim() || null,
                        bankSortCode: form.bankSortCode.trim() || null,
                        bankAccountNumber: form.bankAccountNumber.trim() || null,
                        invoicePrefix: form.invoicePrefix.trim(),
                        nextInvoiceNumber: form.nextInvoiceNumber,
                        creditNotePrefix: form.creditNotePrefix.trim(),
                        nextCreditNoteNumber: form.nextCreditNoteNumber,
                      },
                      "Invoicing settings saved."
                    )
                  }
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Only an Admin can change what invoices print.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lock date</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4 text-sm">
            <p className="text-muted-foreground">
              {settings.lockDate
                ? `The books are locked up to and including ${formatDate(settings.lockDate)}. Nothing on or before that date can be posted or reversed.`
                : "The books are not locked. Set a lock date once a period is final — for example after the accountant signs off the year."}
            </p>
            <div>
              <FormLabel htmlFor="lockDate">Lock up to and including</FormLabel>
              <Input
                id="lockDate"
                type="date"
                className="w-48"
                value={lockDate}
                disabled={!canLock && !canReopen}
                onChange={(e) => setLockDate(e.target.value)}
              />
            </div>
            {reopening && (
              <div>
                <FormLabel htmlFor="reason">Why are you re-opening a locked period?</FormLabel>
                <Input
                  id="reason"
                  value={reason}
                  maxLength={300}
                  placeholder="Recorded in the audit log"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            )}
            {lockAllowed ? (
              <div className="flex justify-end">
                <Button
                  disabled={busy || lockDate === settings.lockDate || (reopening && !reason.trim())}
                  onClick={() =>
                    send(
                      "/api/books/settings/lock-date",
                      { lockDate: lockDate || null, reason: reason.trim() || null },
                      lockDate ? `Books locked up to ${formatDate(lockDate)}.` : "Lock date cleared."
                    )
                  }
                >
                  {reopening ? "Re-open" : "Lock"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {reopening ? "Only an Admin can re-open a locked period." : "Only an Admin can lock the books."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4 text-sm">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={secondApprover}
                disabled={!canEdit}
                onChange={(e) => setSecondApprover(e.target.checked)}
              />
              <span>
                <span className="font-medium">Require a second person to approve</span>
                <span className="block text-muted-foreground">
                  Whoever raised an invoice or credit note can&rsquo;t approve it, and whoever created or posted a
                  journal can&rsquo;t reverse it. While this is off, a person can approve their own work, and each
                  time they do it is marked in the audit log for review. Turning it on needs at least two people with
                  access to the books.
                </span>
              </span>
            </label>
            {canEdit ? (
              <div className="flex justify-end">
                <Button
                  disabled={busy || secondApprover === settings.requireSecondApprover}
                  onClick={() =>
                    send(
                      "/api/books/settings",
                      { requireSecondApprover: secondApprover },
                      secondApprover ? "A second person must now approve." : "Self-approval is allowed again (and marked in the audit log)."
                    )
                  }
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Only an Admin can change this.</p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
