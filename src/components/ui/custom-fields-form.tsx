"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "./input";
import { Select } from "./select-native";
import { FormSection } from "./form-section";
import { clientFetch } from "@/lib/client-fetch";

type Module = "PROJECT" | "PHASE" | "MILESTONE" | "TASK" | "RESOURCE" | "FUNDING_RECORD" | "LIVING_LAB";

interface Definition {
  id: string;
  name: string;
  fieldType: string;
  options: { choices?: string[] } | null;
  required: boolean;
  defaultValue: string | null;
}

/** Form-side value: text for inputs, boolean for checkboxes, array for multi-select. */
type FieldValue = string | boolean | string[];

function emptyValue(def: Definition): FieldValue {
  if (def.fieldType === "BOOLEAN") return def.defaultValue === "true";
  if (def.fieldType === "MULTI_SELECT") return [];
  return def.defaultValue ?? "";
}

function isBlank(def: Definition, v: FieldValue | undefined): boolean {
  if (def.fieldType === "BOOLEAN") return false;
  if (Array.isArray(v)) return v.length === 0;
  return v === undefined || v === "";
}

/** Turns what the API stores back into what the inputs hold. */
function fromStored(def: Definition, stored: { value: unknown } | undefined): FieldValue {
  if (!stored || stored.value === null || stored.value === undefined) return emptyValue(def);
  switch (def.fieldType) {
    case "BOOLEAN":
      return stored.value === true;
    case "MULTI_SELECT":
      return Array.isArray(stored.value) ? (stored.value as string[]) : [];
    case "DATE":
      return String(stored.value).slice(0, 10);
    default:
      return String(stored.value);
  }
}

function toPayload(def: Definition, v: FieldValue | undefined) {
  const blank = isBlank(def, v);
  const base = { definitionId: def.id };
  switch (def.fieldType) {
    case "NUMBER":
      return { ...base, valueNumber: blank ? null : Number(v) };
    case "DATE":
      return { ...base, valueDate: blank ? null : (v as string) };
    case "BOOLEAN":
      return { ...base, valueBoolean: v === true };
    case "MULTI_SELECT":
      return { ...base, valueJson: blank ? null : v };
    default:
      return { ...base, valueString: blank ? null : (v as string) };
  }
}

/**
 * Custom fields for one record type, for use inside a modal's form.
 * `entityId` is null while creating; pass the new record's id to `save` once it exists.
 */
export function useCustomFieldsForm(opts: {
  open: boolean;
  projectId?: string;
  module: Module;
  entityId?: string | null;
}) {
  const { open, projectId, module, entityId } = opts;
  const [defs, setDefs] = useState<Definition[]>([]);
  const [values, setValues] = useState<Record<string, FieldValue>>({});

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const defRes = await clientFetch(`/api/custom-fields/definitions?projectId=${projectId}&module=${module}`);
        if (!defRes.ok) return;
        const definitions: Definition[] = await defRes.json();
        if (!Array.isArray(definitions)) return;
        let stored: { definitionId: string; value: unknown }[] = [];
        if (entityId && definitions.length) {
          const valRes = await clientFetch(`/api/custom-fields/values?entityId=${encodeURIComponent(entityId)}`);
          if (valRes.ok) {
            const body = await valRes.json();
            if (Array.isArray(body)) stored = body;
          }
        }
        if (cancelled) return;
        setDefs(definitions);
        setValues(
          Object.fromEntries(
            definitions.map((d) => [d.id, fromStored(d, stored.find((s) => s.definitionId === d.id))])
          )
        );
      } catch {
        // Custom fields are an extra; the record itself must still be editable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, module, entityId]);

  /** A message for the first required field left empty, else null. */
  const validate = useCallback((): string | null => {
    const missing = defs.find((d) => d.required && isBlank(d, values[d.id]));
    return missing ? `${missing.name} is required` : null;
  }, [defs, values]);

  /** Returns an error message, or null when saved (or nothing to save). */
  const save = useCallback(
    async (id: string): Promise<string | null> => {
      if (!defs.length) return null;
      const res = await clientFetch(`/api/custom-fields/values?projectId=${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: id, values: defs.map((d) => toPayload(d, values[d.id])) }),
      });
      if (res.ok) return null;
      const body = await res.json().catch(() => ({}));
      return body.error ?? `Couldn't save custom fields (${res.status})`;
    },
    [defs, values, projectId]
  );

  const set = (id: string, v: FieldValue) => setValues((s) => ({ ...s, [id]: v }));

  const section = defs.length ? (
    <FormSection title="Custom fields">
      <div className="grid grid-cols-2 gap-4">
        {defs.map((d) => {
          const v = values[d.id];
          const choices = d.options?.choices ?? [];
          return (
            <div key={d.id} className={d.fieldType === "MULTI_SELECT" ? "col-span-2" : undefined}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {d.name}
                {d.required && " *"}
              </label>
              {d.fieldType === "BOOLEAN" ? (
                <input type="checkbox" checked={v === true} onChange={(e) => set(d.id, e.target.checked)} className="h-4 w-4 mt-2" />
              ) : d.fieldType === "SELECT" ? (
                <Select value={(v as string) ?? ""} onChange={(e) => set(d.id, e.target.value)}>
                  <option value="">— None —</option>
                  {choices.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              ) : d.fieldType === "MULTI_SELECT" ? (
                <div className="flex flex-wrap gap-3">
                  {choices.map((c) => {
                    const picked = Array.isArray(v) && v.includes(c);
                    return (
                      <label key={c} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => set(d.id, picked ? (v as string[]).filter((x) => x !== c) : [...(Array.isArray(v) ? v : []), c])}
                        />
                        {c}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <Input
                  type={d.fieldType === "NUMBER" ? "number" : d.fieldType === "DATE" ? "date" : "text"}
                  step={d.fieldType === "NUMBER" ? "any" : undefined}
                  value={(v as string) ?? ""}
                  onChange={(e) => set(d.id, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>
    </FormSection>
  ) : null;

  return { section, save, validate };
}
