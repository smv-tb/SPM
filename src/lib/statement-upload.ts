import { AccountingError } from "@/lib/accounting/errors";
import { MAX_STATEMENT_BYTES } from "@/lib/accounting/statement-import";
import { importProfileSchema } from "@/schemas/books";

/**
 * Reads a statement upload (multipart: `file`, optional `profile` JSON,
 * optional `allowBalanceBreaks`). The file is held in memory only — it is
 * parsed, never stored or executed — and refused early if it is not a small
 * CSV/text file.
 */
export async function readStatementUpload(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AccountingError("BAD_UPLOAD", "Send the statement as a file upload", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AccountingError("BAD_UPLOAD", "Choose a statement file", 400);
  if (!/\.(csv|txt)$/i.test(file.name)) {
    throw new AccountingError("BAD_FILE", "Upload the statement as a .csv file (save it as CSV from Excel)", 422);
  }
  if (file.size > MAX_STATEMENT_BYTES) throw new AccountingError("BAD_FILE", "The file is larger than 5 MB", 422);

  let profile: unknown;
  const rawProfile = form.get("profile");
  if (typeof rawProfile === "string" && rawProfile.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(rawProfile);
    } catch {
      throw new AccountingError("BAD_PROFILE", "The column settings could not be read", 400);
    }
    const parsed = importProfileSchema.safeParse(json);
    if (!parsed.success) throw new AccountingError("BAD_PROFILE", "The column settings are not valid", 400);
    profile = parsed.data;
  }

  return {
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    profile,
    allowBalanceBreaks: form.get("allowBalanceBreaks") === "true",
  };
}
