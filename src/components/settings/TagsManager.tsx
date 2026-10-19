"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientFetch } from "@/lib/client-fetch";

/** Same palette as the tag picker on tasks. */
export const TAG_COLORS = ["#6366f1", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

interface TagRow {
  id: string;
  name: string;
  color: string;
  /** Tasks, milestones and resources carrying it. */
  uses: number;
}

function ColorChoice({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className="w-5 h-5 rounded-full border border-input"
          style={{ backgroundColor: c, outline: value === c ? "2px solid #0f172a" : undefined, outlineOffset: 1 }}
        />
      ))}
    </div>
  );
}

async function errorOf(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

export function TagsManager({ projectId, tags, canEdit }: { projectId: string; tags: TagRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);

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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (await send("create", "/api/tags", "POST", { projectId, name: newName.trim(), color: newColor })) setNewName("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Tags ({tags.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed rounded-lg py-6 text-center">No tags in this project yet.</p>
        ) : (
          <ul className="divide-y divide-border border rounded-lg">
            {tags.map((t) =>
              editing?.id === t.id ? (
                <li key={t.id} className="p-3 space-y-2">
                  <form
                    className="flex items-center gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await send(`edit:${t.id}`, `/api/tags/${t.id}`, "PATCH", { name: editing.name.trim(), color: editing.color })) setEditing(null);
                    }}
                  >
                    <Input aria-label="Tag name" value={editing.name} maxLength={100} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-9" />
                    <Button type="submit" size="sm" disabled={!!busy || !editing.name.trim()} aria-label="Save tag">
                      {busy === `edit:${t.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel">
                      <X className="w-4 h-4" />
                    </Button>
                  </form>
                  <ColorChoice label="Tag colour" value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                </li>
              ) : (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="font-medium truncate">{t.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {t.uses === 0 ? "unused" : `used ${t.uses}×`}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" disabled={!!busy} aria-label={`Edit ${t.name}`} onClick={() => setEditing({ id: t.id, name: t.name, color: t.color })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        aria-label={`Delete ${t.name}`}
                        onClick={async () => {
                          const msg = t.uses
                            ? `Delete "${t.name}"? It is removed from ${t.uses} task(s), milestone(s) or resource(s).`
                            : `Delete "${t.name}"?`;
                          if (await confirmDialog(msg)) void send(`delete:${t.id}`, `/api/tags/${t.id}`, "DELETE");
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-600" />
                      </Button>
                    </div>
                  )}
                </li>
              )
            )}
          </ul>
        )}

        {canEdit && (
          <form onSubmit={create} className="space-y-2 border-t pt-4">
            <div className="flex items-center gap-2">
              <Input aria-label="New tag name" placeholder="New tag name" value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} className="h-9" />
              <Button type="submit" size="sm" disabled={!!busy || !newName.trim()}>
                {busy === "create" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Add tag
              </Button>
            </div>
            <ColorChoice label="New tag colour" value={newColor} onChange={setNewColor} />
          </form>
        )}
      </CardContent>
    </Card>
  );
}
