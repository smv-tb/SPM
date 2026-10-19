"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";

export interface CostCategory {
  id: string;
  name: string;
}

/** Loads the (company-wide) cost categories once; `reload` refetches after a change. */
export function useCostCategories(onError?: (err: unknown) => void) {
  const [categories, setCategories] = useState<CostCategory[]>([]);
  // A reporting callback: a new identity each render must not trigger a refetch.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const reload = useCallback(async () => {
    try {
      const response = await clientFetch("/api/cost-categories");
      if (response.ok) setCategories(await response.json());
    } catch (err) {
      onErrorRef.current?.(err);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { categories, reload };
}
