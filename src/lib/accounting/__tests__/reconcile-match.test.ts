import { describe, it, expect } from "vitest";
import {
  namesCustomer,
  quotesInvoice,
  quotesReference,
  significantWords,
  suggestMatches,
  type BookLineIn,
  type OpenBillIn,
  type OpenInvoiceIn,
  type StatementLineIn,
} from "@/lib/accounting/reconcile-match";

const line = (id: string, date: string, amount: number, description: string): StatementLineIn => ({
  id,
  date,
  amount,
  description,
});
const book = (journalLineId: string, date: string, amount: number, text = ""): BookLineIn => ({
  journalLineId,
  date,
  amount,
  text,
  label: text || journalLineId,
});
const invoice = (id: string, number: string, amountDue: number, contactName = "Acme Frank Ltd"): OpenInvoiceIn => ({
  id,
  number,
  contactId: `c-${contactName}`,
  contactName,
  amountDue,
  issueDate: "2026-05-26",
});

const bill = (id: string, reference: string | null, amountDue: number, contactName = "Paper Mill Ltd"): OpenBillIn => ({
  id,
  reference,
  contactId: `c-${contactName}`,
  contactName,
  amountDue,
  issueDate: "2026-05-26",
});

describe("quotesInvoice", () => {
  it("finds the number however the payer typed it", () => {
    for (const d of ["ACME FRANK INV001", "INV 001 ACME", "REF INV-1", "inv1 thanks", "PAYMENT INV0001"]) {
      expect(quotesInvoice(d, "INV001")).toBe(true);
    }
  });

  it("does not see INV001 inside INV0012 or INV010", () => {
    expect(quotesInvoice("INV0012", "INV001")).toBe(false);
    expect(quotesInvoice("INV010", "INV001")).toBe(false);
    expect(quotesInvoice("XINV001", "INV001")).toBe(false);
  });
});

describe("namesCustomer", () => {
  it("needs every significant word of a short name", () => {
    expect(namesCustomer("ACME FRANK, INV001", "Acme Frank Ltd")).toBe(true);
    expect(namesCustomer("FRANK SMITH", "Acme Frank Ltd")).toBe(false);
  });

  it("is not fooled by company boilerplate", () => {
    expect(significantWords("The Smart Services Group Ltd")).toEqual(["SMART"]);
    expect(namesCustomer("SMART HOME LIMITED", "Smart Services Ltd")).toBe(true);
    expect(namesCustomer("LTD SERVICES PAYMENT", "Smart Services Ltd")).toBe(false);
  });

  it("asks for two words of a long name", () => {
    const name = "North East Innovation Hub Partners";
    expect(namesCustomer("NORTH EAST PAYMENT", name)).toBe(true);
    expect(namesCustomer("NORTH STAR", name)).toBe(false);
  });
});

describe("suggestMatches — entries already in the books", () => {
  it("applies the obvious: same amount, close date, nothing competing", () => {
    const [s] = suggestMatches([line("s1", "2026-06-12", 100000, "ACME FRANK")], [book("j1", "2026-06-10", 100000)], []);
    expect(s.auto?.kind).toBe("BOOK");
    expect(s.auto?.reasons).toContain("The only entry that fits");
  });

  it("does not apply when two book entries could be the line", () => {
    const [s] = suggestMatches(
      [line("s1", "2026-06-12", 100000, "TRANSFER")],
      [book("j1", "2026-06-10", 100000), book("j2", "2026-06-11", 100000)],
      []
    );
    expect(s.candidates).toHaveLength(2);
    expect(s.auto).toBeNull();
  });

  it("lets the description settle it between two entries", () => {
    const [s] = suggestMatches(
      [line("s1", "2026-06-12", 100000, "ACME FRANK")],
      [book("j1", "2026-06-10", 100000, "Payment from Acme Frank Ltd"), book("j2", "2026-06-11", 100000, "Payment from Globex")],
      []
    );
    expect(s.auto?.kind === "BOOK" && s.auto.journalLineIds).toEqual(["j1"]);
  });

  it("does not apply when two statement lines want one entry", () => {
    const out = suggestMatches(
      [line("s1", "2026-06-10", 5000, "A"), line("s2", "2026-06-11", 5000, "B")],
      [book("j1", "2026-06-10", 5000)],
      []
    );
    expect(out.every((s) => s.auto === null)).toBe(true);
  });

  it("ignores entries outside the date window or of another amount", () => {
    const [s] = suggestMatches(
      [line("s1", "2026-06-30", 5000, "X")],
      [book("j1", "2026-06-10", 5000), book("j2", "2026-06-30", 5001)],
      []
    );
    expect(s.candidates).toEqual([]);
  });

  it("matches money out to money out only", () => {
    const [s] = suggestMatches([line("s1", "2026-06-10", -5000, "REFUND")], [book("j1", "2026-06-10", 5000)], []);
    expect(s.candidates).toEqual([]);
  });
});

describe("suggestMatches — open invoices", () => {
  it("applies a payment that quotes the invoice and pays exactly what is due", () => {
    const [s] = suggestMatches([line("s1", "2026-06-10", 125000, "ACME FRANK, INV001")], [], [invoice("i1", "INV001", 125000)]);
    expect(s.auto?.kind === "INVOICE" && s.auto.invoiceIds).toEqual(["i1"]);
  });

  it("suggests, but does not apply, an exact amount that only names the customer", () => {
    const [s] = suggestMatches([line("s1", "2026-06-10", 125000, "ACME FRANK")], [], [invoice("i1", "INV001", 125000)]);
    expect(s.candidates[0].confidence).toBe("MEDIUM");
    expect(s.auto).toBeNull();
  });

  it("shows a part payment that quotes the invoice, never applying it", () => {
    const [s] = suggestMatches([line("s1", "2026-06-10", 100000, "INV001")], [], [invoice("i1", "INV001", 125000)]);
    expect(s.candidates[0].confidence).toBe("LOW");
    expect(s.auto).toBeNull();
  });

  it("finds one transfer paying several of a customer's invoices", () => {
    const [s] = suggestMatches(
      [line("s1", "2026-07-01", 75000, "ACME FRANK INV001 INV002")],
      [],
      [invoice("i1", "INV001", 50000), invoice("i2", "INV002", 25000), invoice("i3", "INV003", 10000)]
    );
    const combo = s.candidates.find((c) => c.kind === "INVOICE" && c.invoiceIds.length === 2);
    expect(combo?.confidence).toBe("HIGH");
    expect(s.auto).toEqual(combo);
  });

  it("does not offer invoices raised after the money arrived", () => {
    const later = { ...invoice("i1", "INV001", 125000), issueDate: "2026-07-01" };
    const [s] = suggestMatches([line("s1", "2026-06-10", 125000, "INV001")], [], [later]);
    expect(s.candidates).toEqual([]);
  });

  it("will not apply when a recorded payment and an open invoice both fit", () => {
    const [s] = suggestMatches(
      [line("s1", "2026-06-10", 125000, "ACME FRANK INV001")],
      [book("j1", "2026-06-10", 125000, "Payment from Acme Frank")],
      [invoice("i1", "INV001", 125000)]
    );
    expect(s.candidates.filter((c) => c.confidence === "HIGH")).toHaveLength(2);
    expect(s.auto).toBeNull();
  });
});

describe("quotesReference", () => {
  it("finds a supplier's reference, but not one too short to mean anything", () => {
    expect(quotesReference("PAPER MILL INV-4471", "INV-4471")).toBe(true);
    expect(quotesReference("PAPER MILL 4471", "4471")).toBe(true);
    expect(quotesReference("PAPER MILL 12 JUNE", "12")).toBe(false);
    expect(quotesReference("PAPER MILL", null)).toBe(false);
  });
});

describe("suggestMatches — open bills", () => {
  it("applies money out that quotes the bill and pays exactly what is due", () => {
    const [s] = suggestMatches([line("s1", "2026-06-10", -14999, "PAPER MILL INV-4471")], [], [], [bill("b1", "INV-4471", 14999)]);
    expect(s.auto?.kind === "BILL" && s.auto.billIds).toEqual(["b1"]);
  });

  it("never offers a bill for money in, or an invoice for money out", () => {
    const [into] = suggestMatches([line("s1", "2026-06-10", 14999, "PAPER MILL INV-4471")], [], [], [bill("b1", "INV-4471", 14999)]);
    expect(into.candidates).toEqual([]);
    const [out] = suggestMatches([line("s1", "2026-06-10", -125000, "ACME FRANK INV001")], [], [invoice("i1", "INV001", 125000)], []);
    expect(out.candidates).toEqual([]);
  });

  it("suggests, but does not apply, an exact amount that only names the supplier", () => {
    const [s] = suggestMatches([line("s1", "2026-06-10", -14999, "PAPER MILL")], [], [], [bill("b1", null, 14999)]);
    expect(s.candidates[0]).toMatchObject({ kind: "BILL", confidence: "MEDIUM" });
    expect(s.auto).toBeNull();
  });

  it("finds one transfer paying several of a supplier's bills", () => {
    const [s] = suggestMatches(
      [line("s1", "2026-07-01", -30000, "PAPER MILL")],
      [],
      [],
      [bill("b1", "A-1001", 20000), bill("b2", "A-1002", 10000), bill("b3", "A-1003", 5000)]
    );
    const combo = s.candidates.find((c) => c.kind === "BILL" && c.billIds.length === 2);
    expect(combo?.kind === "BILL" && combo.billIds).toEqual(["b1", "b2"]);
    expect(s.auto).toBeNull();
  });

  it("does not apply a bill two lines both want", () => {
    const suggestions = suggestMatches(
      [line("s1", "2026-06-10", -14999, "PAPER MILL INV-4471"), line("s2", "2026-06-11", -14999, "PAPER MILL INV-4471")],
      [],
      [],
      [bill("b1", "INV-4471", 14999)]
    );
    expect(suggestions.every((s) => s.auto === null)).toBe(true);
  });
});
