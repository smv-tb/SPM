"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select-native";
import { FormLabel } from "@/components/ui/form-label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { clientFetch } from "@/lib/client-fetch";
import { describePaymentTerms } from "@/lib/accounting/sales";
import { ContactPrivacyPanel } from "@/components/books/ContactPrivacyPanel";
import { Plus, Users } from "lucide-react";

export type ContactType = "CUSTOMER" | "SUPPLIER" | "BOTH";

export interface ContactRow {
  id: string;
  type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  paymentTermsDays: number;
  notes: string | null;
  isArchived: boolean;
  anonymisedAt: string | null;
}

interface Props {
  contacts: ContactRow[];
  canEdit: boolean;
  canDelete: boolean;
  canPrivacy: boolean;
}

const TYPE_LABEL: Record<ContactType, string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  BOTH: "Customer & supplier",
};

const blank: ContactRow = {
  id: "",
  type: "CUSTOMER",
  name: "",
  email: null,
  phone: null,
  taxId: null,
  billingAddress: null,
  shippingAddress: null,
  paymentTermsDays: 0,
  notes: null,
  isArchived: false,
  anonymisedAt: null,
};

export function ContactsClient({ contacts, canEdit, canDelete, canPrivacy }: Props) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<"ALL" | ContactType>("ALL");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  // Off by default: shipping is the billing address unless someone says otherwise.
  const [separateShipping, setSeparateShipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!showArchived && c.isArchived) return false;
      // Filtering by a role includes contacts in both roles, as the API does;
      // filtering by "Both" means exactly that.
      if (filter === "BOTH" && c.type !== "BOTH") return false;
      if ((filter === "CUSTOMER" || filter === "SUPPLIER") && c.type !== filter && c.type !== "BOTH") {
        return false;
      }
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) || (c.email ?? "").toLowerCase().includes(needle)
      );
    });
  }, [contacts, showArchived, filter, search]);

  function open(contact: ContactRow, fresh: boolean) {
    setError("");
    setIsNew(fresh);
    setSeparateShipping(contact.shippingAddress !== null);
    setEditing(contact);
  }

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

  async function save() {
    if (!editing) return;
    const body = {
      type: editing.type,
      name: editing.name,
      email: editing.email,
      phone: editing.phone,
      taxId: editing.taxId,
      billingAddress: editing.billingAddress,
      shippingAddress: separateShipping ? editing.shippingAddress : null,
      paymentTermsDays: editing.paymentTermsDays,
      notes: editing.notes,
    };
    const ok = isNew
      ? await send("/api/books/contacts", "POST", body)
      : await send(`/api/books/contacts/${editing.id}`, "PATCH", body);
    if (ok) setEditing(null);
  }

  return (
    <>
      <Topbar
        title="Contacts"
        subtitle="Customers and suppliers"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Contacts", href: "/books/contacts" },
        ]}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => open({ ...blank }, true)}>
              <Plus className="w-3.5 h-3.5" /> Add contact
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-xs"
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            className="w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value as "ALL" | ContactType)}
          >
            <option value="ALL">Everyone</option>
            <option value="CUSTOMER">Customers</option>
            <option value="SUPPLIER">Suppliers</option>
            <option value="BOTH">Both</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>

        <Card>
          <CardContent className="px-0 py-0">
            {visible.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No contacts"
                description="Customers you invoice and suppliers you buy from live here."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left font-semibold">Name</th>
                    <th className="px-3 py-3 text-left font-semibold">Type</th>
                    <th className="px-3 py-3 text-left font-semibold">Contact</th>
                    <th className="px-3 py-3 text-left font-semibold">Terms</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((contact) => (
                    <tr key={contact.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <span className="font-medium">{contact.name}</span>
                        {contact.isArchived && (
                          <Badge variant="warning" size="sm" className="ml-2">
                            Archived
                          </Badge>
                        )}
                        {contact.taxId && (
                          <span className="block text-xs text-muted-foreground">
                            Taxpayer ID {contact.taxId}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{TYPE_LABEL[contact.type]}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {contact.email ?? contact.phone ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {describePaymentTerms(contact.paymentTermsDays)}
                      </td>
                      <td className="px-5 py-3 w-24 text-right">
                        {canEdit && (
                          <Button variant="ghost" size="sm" onClick={() => open({ ...contact }, false)}>
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
      </main>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{isNew ? "Add contact" : editing.name}</DialogTitle>
              </DialogHeader>

              <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <FormLabel htmlFor="contact-name">Name</FormLabel>
                    <Input
                      id="contact-name"
                      maxLength={200}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel htmlFor="contact-type">Type</FormLabel>
                    <Select
                      id="contact-type"
                      value={editing.type}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value as ContactType })}
                    >
                      {(["CUSTOMER", "SUPPLIER", "BOTH"] as const).map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <FormLabel htmlFor="contact-email">Email</FormLabel>
                    <Input
                      id="contact-email"
                      type="email"
                      value={editing.email ?? ""}
                      onChange={(e) => setEditing({ ...editing, email: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <FormLabel htmlFor="contact-phone">Phone</FormLabel>
                    <Input
                      id="contact-phone"
                      value={editing.phone ?? ""}
                      onChange={(e) => setEditing({ ...editing, phone: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <FormLabel htmlFor="contact-tax">Taxpayer ID</FormLabel>
                    <Input
                      id="contact-tax"
                      placeholder="Their VAT number, if they have one"
                      value={editing.taxId ?? ""}
                      onChange={(e) => setEditing({ ...editing, taxId: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <FormLabel htmlFor="contact-terms">Payment terms (days)</FormLabel>
                    <Input
                      id="contact-terms"
                      type="number"
                      min={0}
                      max={365}
                      value={editing.paymentTermsDays}
                      onChange={(e) =>
                        setEditing({ ...editing, paymentTermsDays: Number(e.target.value) || 0 })
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Invoices will say &ldquo;{describePaymentTerms(
                        Number.isInteger(editing.paymentTermsDays) && editing.paymentTermsDays >= 0
                          ? editing.paymentTermsDays
                          : 0
                      )}
                      &rdquo;.
                    </p>
                  </div>
                </div>

                <div>
                  <FormLabel htmlFor="contact-billing">Billing address</FormLabel>
                  <Textarea
                    id="contact-billing"
                    rows={4}
                    value={editing.billingAddress ?? ""}
                    onChange={(e) => setEditing({ ...editing, billingAddress: e.target.value || null })}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={separateShipping}
                    onChange={(e) => setSeparateShipping(e.target.checked)}
                  />
                  Ships to a different address
                </label>

                {separateShipping && (
                  <div>
                    <FormLabel htmlFor="contact-shipping">Shipping address</FormLabel>
                    <Textarea
                      id="contact-shipping"
                      rows={4}
                      value={editing.shippingAddress ?? ""}
                      onChange={(e) =>
                        setEditing({ ...editing, shippingAddress: e.target.value || null })
                      }
                    />
                  </div>
                )}

                <div>
                  <FormLabel htmlFor="contact-notes">Notes</FormLabel>
                  <Textarea
                    id="contact-notes"
                    rows={2}
                    value={editing.notes ?? ""}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })}
                  />
                </div>

                {!isNew && canPrivacy && (
                  <ContactPrivacyPanel contactId={editing.id} name={editing.name} onDone={() => setEditing(null)} />
                )}

                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>

              <DialogFooter className="justify-between">
                <div className="flex gap-2">
                  {!isNew && canDelete && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        if (!await confirmDialog(`Delete ${editing.name}? Archiving keeps the history.`)) return;
                        if (await send(`/api/books/contacts/${editing.id}`, "DELETE")) setEditing(null);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                  {!isNew && !editing.anonymisedAt && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await send(`/api/books/contacts/${editing.id}`, "PATCH", {
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
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button disabled={busy || !!editing.anonymisedAt || editing.name.trim().length === 0} onClick={save}>
                    {isNew ? "Add contact" : "Save"}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
