"use client";

import { useCallback, useEffect, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";

type Module = "PROJECT" | "PHASE" | "MILESTONE" | "TASK" | "RESOURCE" | "FUNDING_RECORD" | "LIVING_LAB";

interface Definition {
  id: string;
  name: string;
  fieldType: string;
}

function display(def: Definition, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (def.fieldType) {
    case "BOOLEAN":
      return value ? "Yes" : "No";
    case "DATE": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { timeZone: "UTC" });
    }
    case "MULTI_SELECT":
      return Array.isArray(value) && value.length ? value.join(", ") : "—";
    default:
      return String(value);
  }
}

/**
 * The custom fields of one record type as table columns. Loaded on the client so a list
 * that refreshes itself from its own API after a save only has to call `reload`.
 */
export function useCustomFieldColumns(projectId: string | undefined, module: Module) {
  const [columns, setColumns] = useState<Definition[]>([]);
  const [values, setValues] = useState<Map<string, unknown>>(new Map());

  const reload = useCallback(async () => {
    if (!projectId) return;
    try {
      const q = `projectId=${projectId}&module=${module}`;
      const defRes = await clientFetch(`/api/custom-fields/definitions?${q}`);
      if (!defRes.ok) return;
      const defs: Definition[] = await defRes.json();
      if (!Array.isArray(defs)) return;
      let rows: { entityId: string; definitionId: string; value: unknown }[] = [];
      if (defs.length) {
        const valRes = await clientFetch(`/api/custom-fields/values?${q}`);
        if (valRes.ok) {
          const body = await valRes.json();
          if (Array.isArray(body)) rows = body;
        }
      }
      setColumns(defs);
      setValues(new Map(rows.map((r) => [`${r.entityId}:${r.definitionId}`, r.value])));
    } catch {
      // Extra columns must never take the list down.
    }
  }, [projectId, module]);

  useEffect(() => {
    reload();
  }, [reload]);

  const cell = (entityId: string, def: Definition) => display(def, values.get(`${entityId}:${def.id}`));

  return { columns, cell, reload };
}
