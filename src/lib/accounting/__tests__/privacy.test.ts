import { describe, it, expect } from "vitest";
import { retentionUntil, retentionVerdict, auditableContact, RETENTION_YEARS } from "@/lib/accounting/privacy";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe("retentionUntil", () => {
  // The same cases as prisma/checks/contact-anonymisation.sql, so the two cannot drift.
  it("keeps records six years after the end of the financial year (April year)", () => {
    expect(RETENTION_YEARS).toBe(6);
    expect(iso(retentionUntil(d("2018-06-01"), 4, 1))).toBe("2025-03-31");
    expect(iso(retentionUntil(d("2020-04-01"), 4, 1))).toBe("2027-03-31");
  });

  it("the last day of a year belongs to that year, the first day of the next to the next", () => {
    expect(iso(retentionUntil(d("2020-03-31"), 4, 1))).toBe("2026-03-31");
    expect(iso(retentionUntil(d("2020-04-01"), 4, 1))).toBe("2027-03-31");
  });

  it("handles a calendar financial year", () => {
    expect(iso(retentionUntil(d("2018-06-01"), 1, 1))).toBe("2024-12-31");
  });

  it("handles a year starting mid-month", () => {
    expect(iso(retentionUntil(d("2019-10-14"), 10, 15))).toBe("2025-10-14");
    expect(iso(retentionUntil(d("2019-10-15"), 10, 15))).toBe("2026-10-14");
  });

  it("has no date for a contact without documents", () => {
    expect(retentionUntil(null, 4, 1)).toBeNull();
  });
});

describe("retentionVerdict", () => {
  const base = { anonymisedAt: null, hasOpenDocuments: false, retainUntil: "2025-03-31", today: "2026-10-14" };

  it("allows it once the period has passed", () => {
    expect(retentionVerdict(base)).toEqual({ canAnonymise: true, reason: null });
    expect(retentionVerdict({ ...base, retainUntil: null }).canAnonymise).toBe(true);
  });

  it("holds the contact through the last day of the period", () => {
    expect(retentionVerdict({ ...base, retainUntil: "2026-10-14" })).toEqual({
      canAnonymise: false,
      reason: "WITHIN_RETENTION",
      until: "2026-10-14",
    });
    expect(retentionVerdict({ ...base, retainUntil: "2026-10-13" }).canAnonymise).toBe(true);
  });

  it("refuses with open documents, and once already done", () => {
    expect(retentionVerdict({ ...base, hasOpenDocuments: true }).reason).toBe("OPEN_DOCUMENTS");
    expect(retentionVerdict({ ...base, anonymisedAt: new Date() }).reason).toBe("ALREADY_ANONYMISED");
  });
});

describe("auditableContact", () => {
  const contact = {
    id: "c1",
    name: "Acme Ltd",
    type: "CUSTOMER",
    paymentTermsDays: 30,
    email: "jane@acme.example",
    phone: "0191 000 0000",
    taxId: "GB123",
    billingAddress: "1 High Street\nLeeds",
    shippingAddress: null,
    notes: "prefers email",
    isArchived: false,
  };

  it("keeps business fields and replaces personal ones with a marker", () => {
    const out = auditableContact(contact);
    expect(out.name).toBe("Acme Ltd");
    expect(out.paymentTermsDays).toBe(30);
    expect(JSON.stringify(out)).not.toMatch(/jane|acme\.example|0191|GB123|High Street|prefers/);
    expect(out.shippingAddress).toBeNull();
    expect(String(out.email)).toMatch(/^on file #[0-9a-f]{8}$/);
  });

  it("changes the marker when the value changes, and not when it does not", () => {
    expect(auditableContact({ ...contact }).email).toBe(auditableContact({ ...contact }).email);
    expect(auditableContact({ ...contact, email: "other@acme.example" }).email).not.toBe(auditableContact(contact).email);
  });
});
