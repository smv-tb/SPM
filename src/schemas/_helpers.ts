import { z } from "zod";

/**
 * A partial-update schema that leaves absent fields absent.
 *
 * `schema.partial()` is not enough in Zod 4: a field declared with
 * `.default()` still gets its default filled in when the key is missing, so a
 * PATCH of `{ title }` came back as `{ title, status: "BACKLOG", priority:
 * "MED", percentDone: 0 }` and silently reset those columns. Defaults belong to
 * creates only, so they are stripped before the fields are made optional.
 */
export function partialUpdate<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const overrides: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    if (field instanceof z.ZodDefault) overrides[key] = (field.unwrap() as z.ZodType).optional();
  }
  return schema.partial().extend(overrides) as unknown as z.ZodObject<{
    [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K]>;
  }>;
}

/**
 * A calendar date field. The canonical form is `YYYY-MM-DD`, but a full ISO
 * timestamp is also accepted and its date part used — reads return dates as
 * ISO timestamps, so a value copied from a read has to be writable as-is.
 */
export const calendarDate = z.preprocess(
  (value) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : value,
  z.string().date()
);

/**
 * A web link. `z.string().url()` accepts any scheme, including `javascript:`
 * and `data:`, which become script the moment one is rendered as an `href`
 * or `src`. Only http(s) is a link we ever want to store.
 */
export const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:$/i.test(new URL(value).protocol), {
    message: "URL must start with http:// or https://",
  });
