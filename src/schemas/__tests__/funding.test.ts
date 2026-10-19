import { describe, it, expect } from "vitest";
import { fundingSchema, fundingUpdateSchema, fundingStageUpdateSchema, FundingStageEnum } from "@/schemas/funding";
import { FUNDING_STAGES } from "@/lib/funding";

const baseRecord = {
  fundId: "F001",
  fundName: "Innovate UK Grant",
  type: "GRANT",
  section: "PIPELINE",
  source: "Innovate UK",
  amount: 50000,
  projectId: "550e8400-e29b-41d4-a716-446655440000",
};

describe("FundingStageEnum drift guard", () => {
  it("lists the exact same stages, in the same order, as FUNDING_STAGES", () => {
    expect(FundingStageEnum.options).toEqual(FUNDING_STAGES);
  });
});

describe("fundingSchema", () => {
  it("validates a record without any pipeline fields", () => {
    const result = fundingSchema.safeParse(baseRecord);
    expect(result.success).toBe(true);
  });

  it("validates a full pipeline record with all new fields", () => {
    const result = fundingSchema.safeParse({
      ...baseRecord,
      stage: "SUBMITTED",
      probability: 40,
      deadline: "2026-08-01",
      nextAction: "Follow up with programme officer",
      nextActionDate: "2026-07-25",
      contactName: "Jo Bloggs",
      contactEmail: "jo@example.com",
      funderUrl: "https://example.com/grant",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a stage outside the enum", () => {
    const result = fundingSchema.safeParse({ ...baseRecord, stage: "NOT_A_STAGE" });
    expect(result.success).toBe(false);
  });

  it("rejects probability outside 0-100", () => {
    expect(fundingSchema.safeParse({ ...baseRecord, probability: -1 }).success).toBe(false);
    expect(fundingSchema.safeParse({ ...baseRecord, probability: 101 }).success).toBe(false);
    expect(fundingSchema.safeParse({ ...baseRecord, probability: 0 }).success).toBe(true);
    expect(fundingSchema.safeParse({ ...baseRecord, probability: 100 }).success).toBe(true);
  });

  it("treats an empty-string contactEmail/funderUrl as absent rather than invalid", () => {
    const result = fundingSchema.safeParse({ ...baseRecord, contactEmail: "", funderUrl: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactEmail).toBeNull();
      expect(result.data.funderUrl).toBeNull();
    }
  });

  it("rejects a malformed contactEmail", () => {
    const result = fundingSchema.safeParse({ ...baseRecord, contactEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("still applies the default currency", () => {
    const result = fundingSchema.safeParse(baseRecord);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe("GBP");
  });

  it("accepts a non-UUID phaseId (legacy migration-seeded slug IDs, e.g. '<projectId>-phase-0')", () => {
    const result = fundingSchema.safeParse({ ...baseRecord, phaseId: "32a33330-98d8-45d7-8b1f-b0f015c35474-phase-0" });
    expect(result.success).toBe(true);
  });

  it("treats an empty-string phaseId as absent rather than invalid", () => {
    const result = fundingSchema.safeParse({ ...baseRecord, phaseId: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phaseId).toBeNull();
  });
});

describe("fundingUpdateSchema", () => {
  it("allows a partial update with only a pipeline field", () => {
    const result = fundingUpdateSchema.safeParse({ probability: 60 });
    expect(result.success).toBe(true);
  });

  it("allows clearing stage/deadline back to null", () => {
    const result = fundingUpdateSchema.safeParse({ stage: null, deadline: null });
    expect(result.success).toBe(true);
  });
});

describe("fundingStageUpdateSchema", () => {
  it("accepts a bare stage value", () => {
    expect(fundingStageUpdateSchema.safeParse({ stage: "AWARDED" }).success).toBe(true);
  });

  it("rejects a missing stage", () => {
    expect(fundingStageUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an invalid stage", () => {
    expect(fundingStageUpdateSchema.safeParse({ stage: "MAYBE" }).success).toBe(false);
  });
});
