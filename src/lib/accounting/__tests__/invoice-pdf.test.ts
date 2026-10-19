import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  formatInvoiceDate,
  pdfCompany,
  invoicePdfFilename,
  renderInvoicePdf,
  wrapText,
  type InvoicePdfCompany,
  type InvoicePdfInvoice,
} from "@/lib/accounting/invoice-pdf";

const company: InvoicePdfCompany = {
  legalName: "Example Ltd",
  companyNumber: "12345678",
  placeOfRegistration: "England and Wales",
  registeredAddress: "1 High Street\nExampletown AB1 2CD",
  vatNumber: null,
  vatRegistered: false,
  bankAccountName: "Example Ltd",
  bankSortCode: "00-00-00",
  bankAccountNumber: "00000000",
};

/** INV023, as the old tool printed it. */
const invoice: InvoicePdfInvoice = {
  number: "INV001",
  status: "SENT",
  issueDate: "2026-08-23",
  dueDate: "2026-08-23",
  paymentTermsDays: 0,
  sentAt: "2026-09-22T09:00:00.000Z",
  reference: null,
  notes: null,
  billToName: "Acme Frank",
  billToAddress: "2 Mill Lane\nNewcastle upon Tyne AB1 2CD",
  shipToAddress: "2 Mill Lane\nNewcastle upon Tyne AB1 2CD",
  taxId: "GB164369978",
  subtotal: 25_000,
  total: 25_000,
  lines: [
    {
      code: "SMV0002",
      name: "BI Consultation",
      description: null,
      unit: "day",
      quantity: "0.5",
      unitPrice: 50_000,
      amount: 25_000,
    },
  ],
};

describe("formatInvoiceDate", () => {
  it("prints DD/MM/YY, as the invoices do", () => {
    expect(formatInvoiceDate("2026-08-23")).toBe("23/08/26");
    expect(formatInvoiceDate("2026-09-22T09:00:00.000Z")).toBe("22/09/26");
  });
});

describe("wrapText", () => {
  // A crude measure: one unit per character, so the expectations are readable.
  const measure = (line: string) => line.length;

  it("wraps on words", () => {
    expect(wrapText("one two three four", 9, measure)).toEqual(["one two", "three", "four"]);
  });

  it("keeps existing line breaks", () => {
    expect(wrapText("Acme Frank\nAB1 2CD", 40, measure)).toEqual(["Acme Frank", "AB1 2CD"]);
  });

  it("breaks a word that cannot fit rather than overflowing", () => {
    expect(wrapText("abcdefghij", 4, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("returns one empty line for empty text", () => {
    expect(wrapText("", 10, measure)).toEqual([""]);
  });
});

describe("invoicePdfFilename", () => {
  it("is named after the invoice number", () => {
    expect(invoicePdfFilename({ number: "INV001", id: "x" })).toBe("Invoice-INV001.pdf");
  });

  it("falls back to the id for a draft, which has no number", () => {
    expect(invoicePdfFilename({ number: null, id: "abcdef12-3456" })).toBe(
      "Invoice-draft-abcdef12.pdf"
    );
  });
});

describe("renderInvoicePdf", () => {
  it("produces a one-page PDF that parses", async () => {
    const bytes = await renderInvoicePdf(invoice, company);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe("Invoice INV001");
    const [page] = parsed.getPages();
    // A4 portrait, to the nearest point.
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  });

  it("renders a draft, several lines and a missing address without failing", async () => {
    const bytes = await renderInvoicePdf(
      {
        ...invoice,
        number: null,
        status: "DRAFT",
        sentAt: null,
        taxId: null,
        billToAddress: null,
        shipToAddress: null,
        reference: "PO-4471",
        notes: "Thanks for your business.",
        subtotal: 125_000,
        total: 125_000,
        lines: [
          ...invoice.lines,
          {
            code: null,
            name: "Workshop facilitation for the regional living lab programme",
            description: "Two days on site, including preparation and the written summary",
            unit: "day",
            quantity: "2",
            unitPrice: 50_000,
            amount: 100_000,
          },
        ],
      },
      { ...company, registeredAddress: null, bankAccountNumber: null, bankSortCode: null }
    );
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  });

  it("does not need any company details to be set", async () => {
    const bytes = await renderInvoicePdf(invoice, {
      legalName: "",
      companyNumber: null,
      placeOfRegistration: null,
      registeredAddress: null,
      vatNumber: null,
      vatRegistered: false,
      bankAccountName: null,
      bankSortCode: null,
      bankAccountNumber: null,
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("pdfCompany with an encrypted account number", () => {
  it("prints the real number, not the sealed value", async () => {
    const { randomBytes } = await import("node:crypto");
    process.env.DATA_ENCRYPTION_KEYS = `k1:${randomBytes(32).toString("base64")}`;
    const { sealNumber, SETTINGS_NUMBER_CONTEXT } = await import("@/lib/accounting/bank-numbers");
    const sealed = sealNumber("55667788", SETTINGS_NUMBER_CONTEXT);
    expect(pdfCompany({ bankAccountNumber: sealed }).bankAccountNumber).toBe("55667788");
    expect(pdfCompany({ bankAccountNumber: "11112222" }).bankAccountNumber).toBe("11112222"); // legacy row
    expect(pdfCompany({ bankAccountNumber: null }).bankAccountNumber).toBeNull();
  });
});
