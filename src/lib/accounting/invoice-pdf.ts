import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { SETTINGS_NUMBER_CONTEXT, openNumber } from "./bank-numbers";
import { formatPence, type Pence } from "@/lib/money";
import { describePaymentTerms } from "./sales";

/**
 * The invoice as a PDF, laid out like the one the business sends today
 * (Business Finance Assistant's INV018/INV023): seller top left, INVOICE
 * block top right, billing and shipping side by side, a lines table, totals,
 * then payment information.
 *
 * Two deliberate differences: the "Powered by…" footer is gone, and the
 * statutory company details a limited company must show — registration
 * number and place of registration — are printed, which the old invoices
 * left off.
 *
 * pdf-lib rather than a headless browser: it draws the page in-process with
 * embedded standard fonts, so the standalone Docker image needs no Chromium
 * and no font files on disk.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);

export interface InvoicePdfCompany {
  legalName: string;
  companyNumber: string | null;
  placeOfRegistration: string | null;
  registeredAddress: string | null;
  vatNumber: string | null;
  vatRegistered: boolean;
  bankAccountName: string | null;
  bankSortCode: string | null;
  bankAccountNumber: string | null;
}

/** Company settings as the PDF needs them; a missing row prints blanks, not a crash. */
export function pdfCompany(
  settings: { [K in keyof InvoicePdfCompany]?: InvoicePdfCompany[K] | null } | null
): InvoicePdfCompany {
  return {
    legalName: settings?.legalName ?? "",
    companyNumber: settings?.companyNumber ?? null,
    placeOfRegistration: settings?.placeOfRegistration ?? null,
    registeredAddress: settings?.registeredAddress ?? null,
    vatNumber: settings?.vatNumber ?? null,
    vatRegistered: settings?.vatRegistered ?? false,
    bankAccountName: settings?.bankAccountName ?? null,
    bankSortCode: settings?.bankSortCode ?? null,
    bankAccountNumber: settings?.bankAccountNumber
      ? openNumber(settings.bankAccountNumber, SETTINGS_NUMBER_CONTEXT)
      : null,
  };
}

export interface InvoicePdfLine {
  code: string | null;
  name: string;
  description: string | null;
  unit: string;
  /** Exact decimal string, e.g. "0.5". */
  quantity: string;
  unitPrice: Pence;
  amount: Pence;
}

export interface InvoicePdfInvoice {
  /** A credit note is drawn on the same layout; defaults to an invoice. */
  kind?: "invoice" | "credit_note";
  number: string | null;
  status: string;
  /** YYYY-MM-DD. */
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  /** ISO timestamp, or null when it has not gone out yet. */
  sentAt: string | null;
  reference: string | null;
  notes: string | null;
  billToName: string;
  billToAddress: string | null;
  shipToAddress: string | null;
  taxId: string | null;
  subtotal: Pence;
  total: Pence;
  /** Invoices: credit notes applied so far, and what that leaves owing. */
  credited?: Pence;
  amountDue?: Pence;
  /** Credit notes: the number of the invoice being corrected, if any. */
  creditFor?: string | null;
  lines: InvoicePdfLine[];
}

/** DD/MM/YY, as the invoices print dates. */
export function formatInvoiceDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}/${year.slice(2)}`;
}

/**
 * Greedy word wrap to a pixel width, so a long address or description stays
 * inside its column instead of running under the next one. A single word
 * longer than the width is broken rather than left to overflow.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (line: string) => number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (measure(word) <= maxWidth) {
        current = word;
        continue;
      }
      // One unbreakable word: cut it where it stops fitting.
      let chunk = "";
      for (const char of word) {
        if (measure(chunk + char) > maxWidth) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

interface Ctx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}
): void {
  const size = options.size ?? 9;
  const font = options.bold ? ctx.bold : ctx.regular;
  const width = font.widthOfTextAtSize(value, size);
  ctx.page.drawText(value, {
    x: options.align === "right" ? x - width : x,
    y,
    size,
    font,
    color: options.color ?? INK,
  });
}

/** Draws wrapped text downwards from `y`, returning the y below the last line. */
function block(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; leading?: number } = {}
): number {
  const size = options.size ?? 9;
  const font = options.bold ? ctx.bold : ctx.regular;
  const leading = options.leading ?? size + 3;
  let cursor = y;
  for (const line of wrapText(value, maxWidth, (l) => font.widthOfTextAtSize(l, size))) {
    text(ctx, line, x, cursor, options);
    cursor -= leading;
  }
  return cursor;
}

function rule(ctx: Ctx, y: number, from = MARGIN, to = A4.width - MARGIN): void {
  ctx.page.drawLine({
    start: { x: from, y },
    end: { x: to, y },
    thickness: 0.7,
    color: RULE,
  });
}

export async function renderInvoicePdf(
  invoice: InvoicePdfInvoice,
  company: InvoicePdfCompany
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.width, A4.height]);
  const ctx: Ctx = {
    page,
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const isCredit = invoice.kind === "credit_note";
  const credited = invoice.credited ?? 0;
  const due = invoice.amountDue ?? invoice.total;
  pdf.setTitle(`${isCredit ? "Credit note" : "Invoice"} ${invoice.number ?? "draft"}`);
  pdf.setProducer("Smartvie PM");
  pdf.setCreator(company.legalName || "Smartvie PM");

  const right = A4.width - MARGIN;
  const columnWidth = (A4.width - MARGIN * 2 - 24) / 2;

  // ── Header: seller left, invoice block right ──────────────────────────────
  let left = A4.height - MARGIN;
  text(ctx, company.legalName || "—", MARGIN, left, { size: 16, bold: true });
  left -= 20;
  if (company.registeredAddress) {
    left = block(ctx, company.registeredAddress, MARGIN, left, columnWidth, { color: MUTED });
  }

  let head = A4.height - MARGIN;
  text(ctx, isCredit ? "CREDIT NOTE" : "INVOICE", right, head, { size: 20, bold: true, align: "right" });
  head -= 18;
  if (invoice.number) {
    text(ctx, `no. ${invoice.number}`, right, head, { size: 11, align: "right" });
    head -= 16;
  } else {
    text(ctx, "DRAFT — not yet issued", right, head, { size: 11, align: "right", color: MUTED });
    head -= 16;
  }
  text(ctx, formatInvoiceDate(invoice.issueDate), right, head, { align: "right", color: MUTED });
  head -= 13;
  if (isCredit) {
    if (invoice.creditFor) {
      text(ctx, `Against invoice ${invoice.creditFor}`, right, head, { align: "right", color: MUTED });
      head -= 13;
    }
    head -= 5;
    text(ctx, `Credit: ${formatPence(invoice.total)}`, right, head, { size: 12, bold: true, align: "right" });
  } else {
    text(ctx, describePaymentTerms(invoice.paymentTermsDays), right, head, { align: "right", color: MUTED });
    head -= 18;
    text(ctx, `Amount due: ${formatPence(due)}`, right, head, { size: 12, bold: true, align: "right" });
  }
  head -= 15;
  if (invoice.sentAt) {
    text(ctx, `Sent on ${formatInvoiceDate(invoice.sentAt)}`, right, head, { align: "right", color: MUTED });
    head -= 13;
  }
  if (invoice.reference) {
    text(ctx, invoice.reference, right, head, { align: "right", color: MUTED });
    head -= 13;
  }

  // ── Addresses ─────────────────────────────────────────────────────────────
  let y = Math.min(left, head) - 26;
  rule(ctx, y + 14);
  text(ctx, "Billing address", MARGIN, y, { size: 8, bold: true, color: MUTED });
  text(ctx, "Shipping address", MARGIN + columnWidth + 24, y, { size: 8, bold: true, color: MUTED });
  y -= 14;

  const billing = [invoice.billToName, invoice.billToAddress].filter(Boolean).join("\n");
  const shipping = [invoice.billToName, invoice.shipToAddress ?? invoice.billToAddress]
    .filter(Boolean)
    .join("\n");
  const afterBilling = block(ctx, billing, MARGIN, y, columnWidth);
  const afterShipping = block(ctx, shipping, MARGIN + columnWidth + 24, y, columnWidth);
  y = Math.min(afterBilling, afterShipping);

  if (invoice.taxId) {
    y -= 4;
    text(ctx, `Taxpayer ID: ${invoice.taxId}`, MARGIN, y, { color: MUTED });
    y -= 13;
  }

  // ── Lines ─────────────────────────────────────────────────────────────────
  y -= 18;
  const columns = {
    item: MARGIN,
    qty: MARGIN + 300,
    price: MARGIN + 380,
    amount: right,
  };
  text(ctx, "Item name & description", columns.item, y, { size: 8, bold: true, color: MUTED });
  text(ctx, "Qty.", columns.qty, y, { size: 8, bold: true, color: MUTED, align: "right" });
  text(ctx, "Unit price", columns.price, y, { size: 8, bold: true, color: MUTED, align: "right" });
  text(ctx, "Amount", columns.amount, y, { size: 8, bold: true, color: MUTED, align: "right" });
  y -= 6;
  rule(ctx, y);
  y -= 14;

  for (const line of invoice.lines) {
    const title = [line.code, line.name].filter(Boolean).join(" ");
    const titleEnd = block(ctx, title, columns.item, y, 250, { bold: true });
    text(ctx, line.quantity, columns.qty, y, { align: "right" });
    text(ctx, `${formatPence(line.unitPrice)} /${line.unit}`, columns.price, y, { align: "right" });
    text(ctx, formatPence(line.amount), columns.amount, y, { align: "right" });

    let cursor = titleEnd;
    if (line.description) {
      cursor = block(ctx, line.description, columns.item, cursor, 250, { color: MUTED, size: 8.5 });
    }
    y = cursor - 6;
    rule(ctx, y + 8);
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  y -= 10;
  text(ctx, "Subtotal", columns.price, y, { align: "right", color: MUTED });
  text(ctx, formatPence(invoice.subtotal), columns.amount, y, { align: "right" });
  y -= 16;
  text(ctx, isCredit ? "Total credit" : "Total", columns.price, y, { align: "right", size: 11, bold: true });
  text(ctx, formatPence(invoice.total), columns.amount, y, { align: "right", size: 11, bold: true });
  y -= 16;
  if (!isCredit && credited > 0) {
    text(ctx, "Less credit notes", columns.price, y, { align: "right", color: MUTED });
    text(ctx, `-${formatPence(credited)}`, columns.amount, y, { align: "right" });
    y -= 16;
    text(ctx, "Amount due", columns.price, y, { align: "right", size: 11, bold: true });
    text(ctx, formatPence(due), columns.amount, y, { align: "right", size: 11, bold: true });
    y -= 16;
  }
  y -= 10;

  if (isCredit) {
    // ── What the credit does ────────────────────────────────────────────────
    rule(ctx, y + 12);
    text(ctx, "Credit", MARGIN, y, { size: 10, bold: true });
    y -= 15;
    text(
      ctx,
      invoice.creditFor
        ? `${formatPence(invoice.total)} credited against invoice ${invoice.creditFor}.`
        : `${formatPence(invoice.total)} credited to your account.`,
      MARGIN,
      y
    );
    y -= 14;
  } else {
    // ── Payment information ───────────────────────────────────────────────────
    rule(ctx, y + 12);
    text(ctx, "Payment information", MARGIN, y, { size: 10, bold: true });
    y -= 15;
    text(ctx, `${formatPence(due)} on ${formatInvoiceDate(invoice.dueDate)}`, MARGIN, y);
    y -= 14;
    if (company.bankAccountName) {
      text(ctx, company.bankAccountName, MARGIN, y, { color: MUTED });
      y -= 13;
    }
    if (company.bankAccountNumber) {
      text(ctx, `Account number: ${company.bankAccountNumber}`, MARGIN, y, { color: MUTED });
      y -= 13;
    }
    if (company.bankSortCode) {
      text(ctx, `Sort code: ${company.bankSortCode}`, MARGIN, y, { color: MUTED });
      y -= 13;
    }
    if (!company.bankAccountNumber && !company.bankSortCode) {
      text(ctx, "Bank details are not set in company settings.", MARGIN, y, { color: MUTED });
      y -= 13;
    }
  }

  if (invoice.notes) {
    y -= 8;
    y = block(ctx, invoice.notes, MARGIN, y, A4.width - MARGIN * 2, { color: MUTED });
  }

  // ── Statutory footer ──────────────────────────────────────────────────────
  // What a limited company must show on an invoice, and what the old tool's
  // invoices were missing.
  const footer: string[] = [company.legalName].filter(Boolean);
  if (company.companyNumber) {
    footer.push(
      company.placeOfRegistration
        ? `Registered in ${company.placeOfRegistration}, company number ${company.companyNumber}`
        : `Company number ${company.companyNumber}`
    );
  }
  if (company.vatRegistered && company.vatNumber) footer.push(`VAT number ${company.vatNumber}`);

  rule(ctx, MARGIN + 26);
  block(ctx, footer.join(" · "), MARGIN, MARGIN + 14, A4.width - MARGIN * 2, {
    size: 8,
    color: MUTED,
  });

  return pdf.save();
}

/** `Invoice-INV001.pdf` — what the customer sees when they save the attachment. */
export function invoicePdfFilename(invoice: { number: string | null; id: string }): string {
  return `Invoice-${invoice.number ?? `draft-${invoice.id.slice(0, 8)}`}.pdf`;
}

/** `CreditNote-CN001.pdf`. */
export function creditNotePdfFilename(note: { number: string | null; id: string }): string {
  return `CreditNote-${note.number ?? `draft-${note.id.slice(0, 8)}`}.pdf`;
}
