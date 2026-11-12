/**
 * Rules for the supplier documents attached to a bill, pure so they are
 * unit-tested. What a file *is* comes from its first bytes, never from its
 * name or the type the browser claimed: a file that is not really a PDF, PNG
 * or JPEG is refused, and a served one is always a download (see
 * `attachmentDisposition`), so nothing uploaded is ever rendered as a page.
 */

/** Fits under the reverse proxy's 6 MB body limit with room for the multipart wrapper. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_BILL = 10;

export const ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** Extensions each type may keep; the first is used when the name has none of them. */
const EXTENSIONS: Record<AttachmentType, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);

/** The file's real type from its signature, or null for anything else. */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  // "%PDF-"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

/**
 * The name as uploaded, made safe to store and to put in a header: no
 * directory part, no control or quote characters, at most 200 characters,
 * and ending in the extension of what the file really is.
 */
export function cleanAttachmentName(name: string, type: AttachmentType): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  const current = (/\.[^.]*$/.exec(clean)?.[0] ?? "").toLowerCase();
  const kept = EXTENSIONS[type].includes(current);
  const stem = (kept ? clean.slice(0, -current.length) : clean).trim().slice(0, 190) || "document";
  return `${stem}${kept ? current : EXTENSIONS[type][0]}`;
}

/**
 * Always `attachment`: the browser saves the file rather than opening it in
 * our origin. The plain `filename` is an ASCII fallback; `filename*` carries
 * the real name for browsers that read it (RFC 6266 / 5987).
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** "1.2 MB", "340 KB" — for the attachment list. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
