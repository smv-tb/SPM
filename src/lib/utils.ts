import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_LOCALE } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isValidDate(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const d = new Date(date);
  return !isNaN(d.getTime());
}

/** Money for ledgers and budgets: negatives in parentheses, never a bare minus or colour alone. */
export function formatCurrencyAccounting(amount: number | null | undefined, currency = "GBP"): string {
  if (amount == null) return "—";
  const text = formatCurrency(Math.abs(amount), currency);
  return amount < 0 ? `(${text})` : text;
}

export function formatCurrency(amount: number | null | undefined, currency = "GBP"): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date || !isValidDate(date)) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date || !isValidDate(date)) return null;
  const diff = new Date(date).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const STATUS_PERCENT_DONE: Record<string, number> = {
  BACKLOG: 0,
  IN_PROGRESS: 50,
  DONE: 100,
};

/** Derives % done from task status. BLOCKED/ON_HOLD/OVERDUE freeze the previous value. */
export function percentDoneForStatus(status: string, previous: number): number {
  return status in STATUS_PERCENT_DONE ? STATUS_PERCENT_DONE[status] : previous;
}

export function budgetRemaining(
  est: number | null | undefined,
  actual: number | null | undefined
): number | null {
  if (est == null) return null;
  return est - (actual ?? 0);
}
