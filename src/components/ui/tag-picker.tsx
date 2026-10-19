"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "./input";
import { clientFetch } from "@/lib/client-fetch";
import { X, Plus } from "lucide-react";

const TAG_COLORS = [
  "#6366f1", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface TagPickerProps {
  tags: Tag[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  projectId: string;
}

export function TagPicker({ tags, selectedIds, onChange, projectId }: TagPickerProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setError("");
    // clientFetch, not fetch: proxy.ts rejects any mutation without an
    // X-Requested-By header, so the plain-fetch version 403'd every time and
    // the silent `return` below made it look like the button did nothing.
    const res = await clientFetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: newName.trim(), color: newColor }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Couldn't create tag (${res.status})`);
      return;
    }
    const tag = await res.json();
    onChange([...selectedIds, tag.id]);
    setNewName("");
    setNewColor(TAG_COLORS[0]);
  }

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((sid) => sid !== id)
        : [...selectedIds, id]
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const active = selectedIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggle(tag.id)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border transition-all"
              style={{
                backgroundColor: active ? tag.color : "transparent",
                color: active ? "#fff" : tag.color,
                borderColor: tag.color,
              }}
            >
              {tag.name}
              {active && <X className="w-3 h-3" />}
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {creating ? (
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Tag name…"
            className="h-8 text-xs"
          />
          <div className="flex gap-0.5">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className="w-5 h-5 rounded-full border border-border"
                style={{ backgroundColor: c, outline: newColor === c ? "2px solid #000" : undefined, outlineOffset: 1 }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleCreate}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground font-medium"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="text-xs px-2 py-1 rounded text-muted-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3 h-3" /> New Tag
        </button>
      )}
    </div>
  );
}
