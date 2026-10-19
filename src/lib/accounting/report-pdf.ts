import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatPence } from "@/lib/money";
import { formatInvoiceDate, wrapText } from "./invoice-pdf";
import type { ReportRow } from "./balance-sheet";

/**
 * A financial statement or report (balance sheet, profit and loss, trial balance, aged debtors) as a PDF:
 * title and company at the top, a column per date, the rows indented by
 * level, totals ruled off, and as many A4 pages as it takes — the column
 * headings repeat on each. Drawn with pdf-lib like the invoice, so the
 * standalone image needs no browser or fonts.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
/** Wide columns for a few amounts; narrower, smaller type when there are many (aged debtors). */
const columnWidth = (count: number) => (count > 4 ? 58 : 92);

export interface ReportPdf {
  title: string;
  company: { legalName: string; companyNumber: string | null; placeOfRegistration: string | null };
  /** "As at 31/10/26", printed under the title. */
  subtitle: string;
  /** One heading per amount column, e.g. the dates. */
  columns: string[];
  rows: ReportRow[];
  /** A closing sentence, e.g. that the sheet balances. */
  note?: string | null;
}

const INDENT: Record<ReportRow["kind"], number> = {
  section: 0,
  group: 10,
  line: 22,
  detail: 34,
  groupTotal: 10,
  sectionTotal: 0,
  grandTotal: 0,
};

export async function renderReportPdf(report: ReportPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`${report.title} — ${report.company.legalName}`);
  pdf.setProducer("Smartvie PM");

  const COLUMN_WIDTH = columnWidth(report.columns.length);
  const dense = report.columns.length > 4;
  const right = A4.width - MARGIN;
  const amountX = report.columns.map((_, i) => right - (report.columns.length - 1 - i) * COLUMN_WIDTH);
  const labelWidth = amountX[0] - COLUMN_WIDTH + 8 - MARGIN;

  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;

  const text = (value: string, x: number, at: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "right" } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9;
    const width = font.widthOfTextAtSize(value, size);
    page.drawText(value, { x: opts.align === "right" ? x - width : x, y: at, size, font, color: opts.color ?? INK });
  };
  const rule = (at: number, from = MARGIN, thickness = 0.6) =>
    page.drawLine({ start: { x: from, y: at }, end: { x: right, y: at }, thickness, color: RULE });

  const footer = () => {
    const parts = [report.company.legalName];
    if (report.company.companyNumber) {
      parts.push(
        report.company.placeOfRegistration
          ? `Registered in ${report.company.placeOfRegistration}, company number ${report.company.companyNumber}`
          : `Company number ${report.company.companyNumber}`
      );
    }
    text(parts.filter(Boolean).join(" · "), MARGIN, MARGIN - 18, { size: 7.5, color: MUTED });
    text(`Page ${pageNumber}`, right, MARGIN - 18, { size: 7.5, color: MUTED, align: "right" });
  };

  const newPage = () => {
    if (pageNumber > 0) footer();
    page = pdf.addPage([A4.width, A4.height]);
    pageNumber++;
    y = A4.height - MARGIN;
    if (pageNumber === 1) {
      text(report.title, MARGIN, y, { font: bold, size: 18 });
      y -= 20;
      text(report.company.legalName || "—", MARGIN, y, { size: 11 });
      y -= 14;
      text(report.subtitle, MARGIN, y, { color: MUTED });
      y -= 26;
    }
    report.columns.forEach((c, i) => text(c, amountX[i], y, { font: bold, size: 8, color: MUTED, align: "right" }));
    y -= 6;
    rule(y);
    y -= 14;
  };

  newPage();
  for (const row of report.rows) {
    const heading = row.kind === "section" || row.kind === "group";
    const total = row.kind.endsWith("Total");
    const font = heading || total ? bold : regular;
    const size = dense ? 7.5 : row.kind === "section" || row.kind === "grandTotal" ? 10.5 : row.kind === "detail" ? 8.5 : 9;
    const label = row.code ? `${row.code}  ${row.label}` : row.label;
    const lines = wrapText(label, labelWidth - INDENT[row.kind], (l) => font.widthOfTextAtSize(l, size));
    const height = lines.length * (size + 3) + (row.kind === "section" ? 8 : total ? 6 : 2);
    if (y - height < MARGIN + 10) newPage();

    if (row.kind === "section") y -= 4;
    // Totals get room above them for their rule, clear of the row before.
    if (total) {
      y -= 5;
      rule(y + size + 2, amountX[0] - COLUMN_WIDTH + 12, row.kind === "groupTotal" ? 0.4 : 0.8);
    }
    lines.forEach((l, i) =>
      text(l, MARGIN + INDENT[row.kind], y - i * (size + 3), {
        font,
        size,
        color: row.kind === "detail" ? MUTED : INK,
      })
    );
    row.amounts.forEach((amount, i) => {
      if (amount === null) return;
      text(formatPence(amount), amountX[i], y, { font, size, color: row.kind === "detail" ? MUTED : INK, align: "right" });
    });
    y -= height;
    if (row.kind === "grandTotal" || row.kind === "sectionTotal") y -= 6;
  }

  if (report.note) {
    if (y < MARGIN + 40) newPage();
    y -= 8;
    for (const l of wrapText(report.note, right - MARGIN, (s) => regular.widthOfTextAtSize(s, 8.5))) {
      text(l, MARGIN, y, { size: 8.5, color: MUTED });
      y -= 12;
    }
  }
  footer();
  return pdf.save();
}

/** "31/10/26" for a column heading. */
export const columnDate = (isoDate: string) => formatInvoiceDate(isoDate);
