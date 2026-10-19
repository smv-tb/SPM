/**
 * Centralized application constants to eliminate magic numbers/strings.
 */

// Pagination
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
export const FUNDING_MAX_PAGE_LIMIT = 500;

// Auth
export const BCRYPT_ROUNDS = 12;

// Currency / Locale (from environment or sensible defaults)
export const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? "GBP";
export const DEFAULT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? "en-GB";
export const DEFAULT_DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
/**
 * The zone that decides what "today" means for the books. Servers run on UTC,
 * which in British Summer Time would date things a day early before 1am.
 */
export const BUSINESS_TIME_ZONE = process.env.NEXT_PUBLIC_BUSINESS_TIME_ZONE ?? "Europe/London";

// Support contact shown in the sidebar; the link is hidden when unset.
// Baked in at build time, so set it before `docker compose build`.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";

// CSV
export const CSV_CHUNK_SIZE = 1000;

// Brand / Display
export const ORGANIZATION_NAME = "Smartvie Ecosystem";
export const APP_SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";

// Shared Prisma select fields
export const USER_SELECT_FIELDS = {
  id: true,
  name: true,
  email: true,
} as const;
