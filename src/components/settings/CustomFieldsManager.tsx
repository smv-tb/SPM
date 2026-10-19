"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetch";

const MODULES = [
  ["TASK", "Tasks"],
  ["MILESTONE", "Milestones"],
  ["PHASE", "Phases"],
  ["RESOURCE", "Resources"],
  ["FUNDING_RECORD", "Funding records"],
  ["LIVING_LAB", "Living labs"],
  ["PROJECT", "Project"],
] as const;
type Module = (typeof MODULES)[number][0];

const TYPES = [
  ["TEXT", "Text"],
  ["NUMBER", "Number"],
  ["DATE", "Date"],
  ["BOOLEAN", "Yes / no"],
  ["SELECT", "Choose one"],
  ["MULTI_SELECT", "Choose several"],
] as const;
type FieldType = (typeof TYPES)[number][0];
const typeLabel = Object.fromEntries(TYPES) as Record<string, string>;
const hasChoices = (t: string) => t === "SELECT" || t === "MULTI_SELECT";

export interface FieldRow {
  id: string;
  module: string;
  name: string;
  fieldType: string;
  required: boolean;
  defaultValue: string | null;
  orderIndex: number;
  choices: string[];
  /** Values already recorded against it. */
  values: number;
}

interface Draft {
  id: string | null;
  module: Module;
  name: string;
  fieldType: FieldType;
  required: boolean;
  defaultValue: string;
  choices: string;
}

async function errorOf(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  if (typeof body.error === "string" && body.details?.fieldErrors) {
    const first = Object.values(body.details.fieldErrors as Record<string, string[]>).flat()[0];
    if (first) return first;
  }
  return typeof body.error === "string" ? body.error : fallback;
}

export function CustomFieldsManager({ projectId, fields, canEdit }: { projectId: string; fields: FieldRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [module, setModule] = useState<Module>("TASK");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const inModule = fields.filter((f) => f.module === module).sort((a, b) => a.orderIndex - b.orderIndex);
  const countFor = (m: string) => fields.filter((f) => f.module === m).length;

  async function send(key: string, url: string, method: string, body?: unknown) {
    setBusy(key);
    setError(null);
    try {
      const res = await clientFetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        setError(await errorOf(res, "That didn't work"));
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const choices = draft.choices.split("\n").map((c) => c.trim()).filter(Boolean);
    const common = {
      name: draft.name.trim(),
      required: draft.required,
      defaultValue: draft.defaultValue.trim() || null,
      // Only choice fields carry options; a JSON null would need special handling server-side.
      ...(hasChoices(draft.fieldType) ? { options: { choices: [...new Set(choices)] } } : {}),
    };
    const ok = draft.id
      ? await send("save", `/api/custom-fields/definitions/${draft.id}`, "PATCH", common)
      : await send("save", "/api/custom-fields/definitions", "POST", {
          ...common,
          projectId,
          module: draft.module,
          fieldType: draft.fieldType,
          orderIndex: inModule.length ? Math.max(...inModule.map((f) => f.orderIndex)) + 1 : 0,
        });
    if (ok) {
      setModule(draft.module); // show the field where it was added
      setDraft(null);
    }
  }

  /** Swap with the neighbour; renumbering the whole list keeps the order unambiguous. */
  async function move(index: number, by: -1 | 1) {
    const order = [...inModule];
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setBusy("move");
    setError(null);
    try {
      for (const [i, f] of order.entries()) {
        if (f.orderIndex === i) continue;
        const res = await clientFetch(`/api/custom-fields/definitions/${f.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIndex: i }),
        });
        if (!res.ok) {
          setError(await errorOf(res, "Could not reorder"));
          break;
        }
      }
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-semibold">Custom fields</CardTitle>
          {canEdit && (
            <Button size="sm" onClick={() => setDraft({ id: null, module, name: "", fieldType: "TEXT", required: false, defaultValue: "", choices: "" })}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add field
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Extra fields recorded against this project&apos;s records. Agents and the API read and write their values.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="tablist" aria-label="Record type" className="flex flex-wrap gap-1.5">
          {MODULES.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={module === value}
              onClick={() => setModule(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                module === value ? "bg-primary text-white border-blue-600" : "bg-card text-muted-foreground hover:bg-surface-container-low"
              }`}
            >
              {label}
              {countFor(value) > 0 && <span className="ml-1 opacity-75">{countFor(value)}</span>}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {inModule.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed rounded-lg py-6 text-center">No custom fields here yet.</p>
        ) : (
          <ul className="divide-y divide-border border rounded-lg">
            {inModule.map((f, i) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{f.name}</span>
                    <Badge variant="neutral" size="sm">{typeLabel[f.fieldType] ?? f.fieldType}</Badge>
                    {f.required && <Badge variant="warning" size="sm">Required</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {f.choices.length > 0 && <>Choices: {f.choices.join(", ")} · </>}
                    {f.defaultValue && <>Default: {f.defaultValue} · </>}
                    {f.values === 0 ? "no values yet" : `${f.values} value${f.values === 1 ? "" : "s"} recorded`}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="sm" disabled={!!busy || i === 0} aria-label={`Move ${f.name} up`} onClick={() => move(i, -1)}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!!busy || i === inModule.length - 1} aria-label={`Move ${f.name} down`} onClick={() => move(i, 1)}>
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      aria-label={`Edit ${f.name}`}
                      onClick={() =>
                        setDraft({
                          id: f.id,
                          module: f.module as Module,
                          name: f.name,
                          fieldType: f.fieldType as FieldType,
                          required: f.required,
                          defaultValue: f.defaultValue ?? "",
                          choices: f.choices.join("\n"),
                        })
                      }
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      aria-label={`Delete ${f.name}`}
                      onClick={async () => {
                        const msg = f.values
                          ? `Delete "${f.name}" and the ${f.values} value(s) recorded in it? This cannot be undone.`
                          : `Delete "${f.name}"?`;
                        if (await confirmDialog(msg)) void send(`delete:${f.id}`, `/api/custom-fields/definitions/${f.id}`, "DELETE");
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-600" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-[460px]">
          {draft && (
            <form onSubmit={save} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit field" : "Add field"}</DialogTitle>
                <DialogDescription>
                  {MODULES.find(([m]) => m === draft.module)?.[1]}
                  {draft.id && " · the record type and kind of field can't change once created"}
                </DialogDescription>
              </DialogHeader>

              {!draft.id && (
                <div className="space-y-2">
                  <Label htmlFor="cf-module">Record type</Label>
                  <select id="cf-module" value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value as Module })} className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm">
                    {MODULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="cf-name">Name</Label>
                <Input id="cf-name" required maxLength={255} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              {!draft.id && (
                <div className="space-y-2">
                  <Label htmlFor="cf-type">Kind of field</Label>
                  <select id="cf-type" value={draft.fieldType} onChange={(e) => setDraft({ ...draft, fieldType: e.target.value as FieldType })} className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm">
                    {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              {hasChoices(draft.fieldType) && (
                <div className="space-y-2">
                  <Label htmlFor="cf-choices">Choices (one per line)</Label>
                  <textarea
                    id="cf-choices"
                    required
                    value={draft.choices}
                    onChange={(e) => setDraft({ ...draft, choices: e.target.value })}
                    className="flex min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="cf-default">Default value (optional)</Label>
                <Input id="cf-default" value={draft.defaultValue} onChange={(e) => setDraft({ ...draft, defaultValue: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <input id="cf-required" type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
                <label htmlFor="cf-required">Required</label>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" disabled={busy === "save"}>
                  {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : draft.id ? "Save" : "Add field"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
