"use client";

import { useEffect, useState } from "react";

export type SortDirection = "asc" | "desc";
export type Accessor<T> = (item: T) => string | number | Date | null | undefined;

interface StoredSort {
  key: string | null;
  dir: SortDirection;
}

/**
 * @param storageKey When provided, the chosen column/direction is persisted to
 * localStorage under this key and restored on future visits. Restoration happens
 * in an effect (not the initial state) so the server-rendered markup always
 * matches the client's first paint, avoiding a hydration mismatch.
 */
export function useSort(storageKey?: string, initialKey: string | null = null, initialDir: SortDirection = "asc") {
  const [sortKey, setSortKey] = useState<string | null>(initialKey);
  const [sortDir, setSortDir] = useState<SortDirection>(initialDir);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredSort>;
      if (typeof parsed.key === "string") setSortKey(parsed.key);
      if (parsed.dir === "asc" || parsed.dir === "desc") setSortDir(parsed.dir);
    } catch {
      // malformed or inaccessible storage — fall back to defaults
    }
  }, [storageKey]);

  function toggleSort(key: string) {
    const nextDir: SortDirection = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    setSortKey(key);
    setSortDir(nextDir);
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ key, dir: nextDir } satisfies StoredSort));
      } catch {
        // storage disabled/full — sort still works for this session
      }
    }
  }

  return { sortKey, sortDir, toggleSort };
}

// Nulls/empty values always sort to the end, regardless of direction.
export function sortItems<T>(
  items: T[],
  accessors: Record<string, Accessor<T>>,
  sortKey: string | null,
  sortDir: SortDirection
): T[] {
  const accessor = sortKey ? accessors[sortKey] : null;
  if (!accessor) return items;

  return [...items].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    const aEmpty = av == null || av === "";
    const bEmpty = bv == null || bv === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;

    let cmp: number;
    if (av instanceof Date || bv instanceof Date) {
      cmp = new Date(av as string | number | Date).getTime() - new Date(bv as string | number | Date).getTime();
    } else if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
}
