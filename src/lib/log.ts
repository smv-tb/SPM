/**
 * Server-side logging that cannot leak (S3.5).
 *
 * Everything the server writes to stdout/stderr goes through `logError` /
 * `logWarn` / `logInfo`. Container logs are copied around (ssh, `docker logs`,
 * a log shipper), kept far longer than a request and read by more people than
 * can open the database, so they must never hold a password, token, bank
 * number or someone's email address. Two rules do the work:
 *
 *  1. **Log the error, not the request.** An error is reduced to its name,
 *     Prisma code, and a redacted, truncated message — never the thrown
 *     object itself (a Prisma error embeds the failed call's arguments, which
 *     is the row being written). Request URLs lose their query string. The
 *     correlation id ties the log line to the `errorId` the caller was shown.
 *  2. **Redact what remains.** Values under sensitive keys are replaced, and
 *     text is scrubbed for emails, bearer/API tokens, JWTs, long digit runs
 *     (account and card numbers) and `key=value` secrets.
 *
 * Dependency-free (no Prisma, no Next) so it is unit-tested directly and could
 * be used from the standalone scripts.
 */

const REDACTED = "[redacted]";
const MAX_MESSAGE = 600;
const MAX_STACK_LINES = 6;
const MAX_DEPTH = 4;

/** Keys whose values are never logged, whatever they hold. Compared lower-cased, ignoring `_` and `-`. */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|apikey|credential|bearer|signature|totp|recovery|otp|^code$|sortcode|accountnumber|accountno|iban|cardnumber|cvv|ssn|nino|bank(number|account|detail|sort)|^number$|hash|privatekey|encryptionkey|session(id)?$/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const API_TOKEN = /\bsvp_[A-Za-z0-9_-]{6,}/g;
/** `password=abc`, `"token": "abc"`, `secret: abc` inside free text. */
const KEY_VALUE =
  /\b(pass(?:word|wd)?|secret|token|api[_-]?key|authorization|cookie|signature|totp|recovery[_-]?code)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi;
/** Credentials inside a connection string: scheme://user:pass@host. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
/** Eight or more digits in a row, a card number in groups of four, or a sort code followed by an account number. Dates (2026-10-14) and the digit groups of a UUID (the correlation id) are left alone. */
const LONG_DIGITS = /(?<![\w-])\d{8,}(?![\w-])|\b(?:\d{4}[ -]){3}\d{4}\b|\b\d{2}-\d{2}-\d{2}[ -]\d{6,8}\b/g;

/** Scrubs free text. Safe to call on anything; non-strings are stringified first. */
export function redactText(input: unknown): string {
  let text = typeof input === "string" ? input : String(input);
  text = text
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(JWT, REDACTED)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(API_TOKEN, REDACTED)
    .replace(KEY_VALUE, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(EMAIL, maskEmail)
    .replace(LONG_DIGITS, (m) => `••••${m.replace(/\D/g, "").slice(-2)}`);
  return text;
}

/** `jane.doe@example.com` → `j***@example.com`: enough to tell two accounts apart in a log, not to contact anyone. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return REDACTED;
  return `${email[0]}***${email.slice(at)}`;
}

function keyIsSensitive(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[_-]/g, ""));
}

/** Deep copy with sensitive keys blanked and every string scrubbed. Bounded in depth and size. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(redactText(value), MAX_MESSAGE);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return describeError(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = keyIsSensitive(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  return `[${typeof value}]`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text;
}

/**
 * The path of a request URL without its query string or fragment (`?token=`,
 * `?email=` and the like have no place in a log). Anything unparseable is
 * reduced to `unknown`.
 */
export function safePath(url: string | undefined | null): string {
  if (!url) return "unknown";
  try {
    return new URL(url, "http://local").pathname;
  } catch {
    return "unknown";
  }
}

export interface ErrorSummary {
  name: string;
  /** Prisma / Node error code, when there is one (`P2002`, `ECONNREFUSED`). */
  code?: string;
  message: string;
  /** Prisma's `meta.target` / `meta.modelName`: which constraint, never which values. */
  target?: unknown;
  stack?: string;
}

/**
 * Reduces anything thrown to a loggable summary. For Prisma's validation and
 * request errors the message begins with the failed invocation, including the
 * data that was being written, so only its final line (the actual reason) is
 * kept.
 */
export function describeError(error: unknown): ErrorSummary {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: truncate(redactText(typeof error === "object" ? safeJson(error) : String(error)), MAX_MESSAGE) };
  }
  const withCode = error as Error & { code?: unknown; meta?: { target?: unknown; modelName?: unknown } };
  const isPrisma = /^PrismaClient/.test(error.name) || /Invalid `prisma\./.test(error.message);
  const raw = isPrisma ? lastMeaningfulLine(error.message) : error.message;
  const summary: ErrorSummary = {
    name: error.name,
    message: truncate(redactText(raw), MAX_MESSAGE),
  };
  if (typeof withCode.code === "string" || typeof withCode.code === "number") summary.code = String(withCode.code);
  const target = withCode.meta?.target ?? withCode.meta?.modelName;
  if (target !== undefined) summary.target = redactValue(target);
  if (error.stack) {
    // Frames are file paths and line numbers; drop the first line (it repeats the message).
    const frames = error.stack.split("\n").slice(1, 1 + MAX_STACK_LINES).map((l) => redactText(l.trim()));
    if (frames.length) summary.stack = frames.join("\n");
  }
  return summary;
}

function lastMeaningfulLine(message: string): string {
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(redactValue(value));
  } catch {
    return "[unserialisable]";
  }
}

type Level = "error" | "warn" | "info";

function write(level: Level, label: string, message: string, context?: Record<string, unknown>) {
  const line = `[${label}] ${redactText(message)}${context && Object.keys(context).length ? ` ${safeJson(context)}` : ""}`;
  // The only direct console use on the server; src/lib/__tests__/no-raw-console.test.ts keeps it that way.
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** `error` may be anything thrown. `context` is redacted by key and by content, so ids and counts are fine, secrets are not. */
export function logError(label: string, message: string, error?: unknown, context?: Record<string, unknown>) {
  write("error", label, message, error === undefined ? context : { ...context, error: describeError(error) });
}

export function logWarn(label: string, message: string, context?: Record<string, unknown>) {
  write("warn", label, message, context);
}

export function logInfo(label: string, message: string, context?: Record<string, unknown>) {
  write("info", label, message, context);
}

/**
 * A request failure: method, path (no query), the correlation id the caller
 * saw as `errorId`, and the summarised error. Never the body, headers or URL query.
 */
export function logRequestError(errorId: string, req: { method?: string; url?: string } | undefined, error: unknown) {
  logError("route-error", `${errorId} ${req?.method ?? "UNKNOWN"} ${safePath(req?.url)}`, error);
}
