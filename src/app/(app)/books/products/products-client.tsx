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
import { formatPence, fromPence } from "@/lib/money";
import { COMMON_UNITS, normaliseProductCode, validateProductCode } from "@/lib/accounting/sales";
import { Package, Plus } from "lucide-react";

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  /** Integer pence, as the books API sends money. */
  unitPrice: number;
  incomeAccountId: string | null;
  incomeAccountCode: string | null;
  incomeAccountName: string | null;
  isArchived: boolean;
}

export interface IncomeAccountOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  products: ProductRow[];
  incomeAccounts: IncomeAccountOption[];
  /** Code of the account a line falls back to when none is chosen. */
  defaultIncomeCode: string;
  canEdit: boolean;
  canDelete: boolean;
}

interface Draft extends Omit<ProductRow, "unitPrice"> {
  /** Kept as typed text so "500." and "500.00" survive editing. */
  unitPrice: string;
}

const blank: Draft = {
  id: "",
  code: "",
  name: "",
  description: null,
  unit: "day",
  unitPrice: "",
  incomeAccountId: null,
  incomeAccountCode: null,
  incomeAccountName: null,
  isArchived: false,
};

export function ProductsClient({
  products,
  incomeAccounts,
  defaultIncomeCode,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!showArchived && p.isArchived) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle);
    });
  }, [products, showArchived, search]);

  const codeProblem = editing ? validateProductCode(normaliseProductCode(editing.code)) : null;

  function open(product: ProductRow | null) {
    setError("");
    setIsNew(product === null);
    setEditing(product ? { ...product, unitPrice: fromPence(product.unitPrice) } : { ...blank });
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
      code: normaliseProductCode(editing.code),
      name: editing.name,
      description: editing.description,
      unit: editing.unit,
      // Blank means free, not "leave the price alone" — the field always shows
      // what will be saved.
      unitPrice: editing.unitPrice.trim() === "" ? "0" : editing.unitPrice.trim(),
      incomeAccountId: editing.incomeAccountId,
    };
    const ok = isNew
      ? await send("/api/books/products", "POST", body)
      : await send(`/api/books/products/${editing.id}`, "PATCH", body);
    if (ok) setEditing(null);
  }

  return (
    <>
      <Topbar
        title="Products and services"
        subtitle="What goes on an invoice line"
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Products", href: "/books/products" },
        ]}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => open(null)}>
              <Plus className="w-3.5 h-3.5" /> Add item
            </Button>
          ) : null
        }
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-xs"
            placeholder="Search code or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
                icon={Package}
                title="Nothing to sell yet"
                description="Add the services you invoice for — a code, a unit and a default price."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left font-semibold">Code</th>
                    <th className="px-3 py-3 text-left font-semibold">Name</th>
                    <th className="px-3 py-3 text-left font-semibold">Income account</th>
                    <th className="px-3 py-3 text-right font-semibold">Unit price</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((product) => (
                    <tr key={product.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 tabular-nums text-muted-foreground">{product.code}</td>
                      <td className="px-3 py-3">
                        <span className="font-medium">{product.name}</span>
                        {product.isArchived && (
                          <Badge variant="warning" size="sm" className="ml-2">
                            Archived
                          </Badge>
                        )}
                        {product.description && (
                          <span className="block text-xs text-muted-foreground">{product.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {product.incomeAccountCode
                          ? `${product.incomeAccountCode} ${product.incomeAccountName}`
                          : `${defaultIncomeCode} (default)`}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPence(product.unitPrice)}
                        <span className="text-muted-foreground"> /{product.unit}</span>
                      </td>
                      <td className="px-5 py-3 w-24 text-right">
                        {canEdit && (
                          <Button variant="ghost" size="sm" onClick={() => open(product)}>
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
        <DialogContent className="max-w-xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{isNew ? "Add item" : `${editing.code} ${editing.name}`}</DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <FormLabel htmlFor="product-code">Code</FormLabel>
                    <Input
                      id="product-code"
                      maxLength={24}
                      placeholder="SMV0002"
                      value={editing.code}
                      onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    />
                    {editing.code.length > 0 && codeProblem && (
                      <p className="mt-1 text-xs text-red-600">{codeProblem}</p>
                    )}
                  </div>
                  <div>
                    <FormLabel htmlFor="product-name">Name</FormLabel>
                    <Input
                      id="product-name"
                      maxLength={200}
                      placeholder="BI Consultation"
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel htmlFor="product-price">Unit price (£)</FormLabel>
                    <Input
                      id="product-price"
                      inputMode="decimal"
                      placeholder="500.00"
                      value={editing.unitPrice}
                      onChange={(e) => setEditing({ ...editing, unitPrice: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel htmlFor="product-unit">Per</FormLabel>
                    <Select
                      id="product-unit"
                      value={COMMON_UNITS.includes(editing.unit as (typeof COMMON_UNITS)[number]) ? editing.unit : "__other"}
                      onChange={(e) =>
                        setEditing({ ...editing, unit: e.target.value === "__other" ? "" : e.target.value })
                      }
                    >
                      {COMMON_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                      <option value="__other">something else…</option>
                    </Select>
                    {!COMMON_UNITS.includes(editing.unit as (typeof COMMON_UNITS)[number]) && (
                      <Input
                        className="mt-2"
                        maxLength={30}
                        placeholder="e.g. workshop"
                        value={editing.unit}
                        onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                      />
                    )}
                  </div>
                </div>

                <div>
                  <FormLabel htmlFor="product-description">Description</FormLabel>
                  <Textarea
                    id="product-description"
                    rows={2}
                    placeholder="Printed under the name on the invoice line"
                    value={editing.description ?? ""}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value || null })}
                  />
                </div>

                <div>
                  <FormLabel htmlFor="product-account">Income account</FormLabel>
                  <Select
                    id="product-account"
                    value={editing.incomeAccountId ?? ""}
                    onChange={(e) => setEditing({ ...editing, incomeAccountId: e.target.value || null })}
                  >
                    <option value="">{defaultIncomeCode} Sales (default)</option>
                    {incomeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Where approving an invoice credits the sale.
                  </p>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>

              <DialogFooter className="justify-between">
                <div className="flex gap-2">
                  {!isNew && canDelete && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        if (!await confirmDialog(`Delete ${editing.code}? Archiving keeps it off new invoices.`)) return;
                        if (await send(`/api/books/products/${editing.id}`, "DELETE")) setEditing(null);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                  {!isNew && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await send(`/api/books/products/${editing.id}`, "PATCH", {
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
                  <Button
                    disabled={
                      busy ||
                      codeProblem !== null ||
                      editing.name.trim().length === 0 ||
                      editing.unit.trim().length === 0
                    }
                    onClick={save}
                  >
                    {isNew ? "Add item" : "Save"}
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
