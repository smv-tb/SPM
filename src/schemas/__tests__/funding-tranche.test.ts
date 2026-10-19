import { describe, it, expect } from "vitest";
import {
  fundingTrancheSchema,
  fundingTrancheUpdateSchema,
  fundingTrancheReceiveSchema,
} from "@/schemas/funding-tranche";

const base = {
  fundingRecordId: "550e8400-e29b-41d4-a716-446655440000",
  label: "Q1 payment",
  amount: 10000,
  dueDate: "2026-08-01",
};

describe("fundingTrancheSchema", () => {
  it("validates a minimal correct payload and defaults status/direction", () => {
    const result = fundingTrancheSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("PENDING");
      expect(result.data.direction).toBe("INCOMING");
    }
  });

  it("accepts an OUTGOING direction (e.g. a loan repayment)", () => {
    const result = fundingTrancheSchema.safeParse({ ...base, direction: "OUTGOING" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.direction).toBe("OUTGOING");
  });

  it("rejects an invalid direction", () => {
    expect(fundingTrancheSchema.safeParse({ ...base, direction: "SIDEWAYS" }).success).toBe(false);
  });

  // Funding records seeded by the ODS migration have composite IDs
  // ("<projectId>-<fundId>"), so a UUID check here made it impossible to add a
  // tranche to any migrated record. Same call as phaseId in schemas/funding.ts.
  it("accepts a legacy composite fundingRecordId", () => {
    const legacyId = "550e8400-e29b-41d4-a716-446655440000-F001";
    const result = fundingTrancheSchema.safeParse({ ...base, fundingRecordId: legacyId });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fundingRecordId).toBe(legacyId);
  });

  it("rejects an empty fundingRecordId", () => {
    expect(fundingTrancheSchema.safeParse({ ...base, fundingRecordId: "" }).success).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(fundingTrancheSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });

  it("rejects a missing dueDate", () => {
    const rest: Record<string, unknown> = { ...base };
    delete rest.dueDate;
    expect(fundingTrancheSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an invalid status", () => {
    expect(fundingTrancheSchema.safeParse({ ...base, status: "CANCELLED" }).success).toBe(false);
  });

  it("accepts an optional milestoneId", () => {
    const result = fundingTrancheSchema.safeParse({
      ...base,
      milestoneId: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(result.success).toBe(true);
  });
});

describe("fundingTrancheUpdateSchema", () => {
  it("allows a partial update with just a status change", () => {
    expect(fundingTrancheUpdateSchema.safeParse({ status: "DELAYED" }).success).toBe(true);
  });

  it("allows an empty object (no-op update)", () => {
    expect(fundingTrancheUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe("fundingTrancheReceiveSchema", () => {
  it("allows an empty body (receivedDate defaults server-side)", () => {
    expect(fundingTrancheReceiveSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an explicit receivedDate", () => {
    expect(fundingTrancheReceiveSchema.safeParse({ receivedDate: "2026-07-01" }).success).toBe(true);
  });
});
