import { z } from "zod";
import { httpUrl } from "./_helpers";

// Enums shared with milestone.ts
export const FundingTypeEnum = z.enum([
  "BOOTSTRAP",
  "GRANT",
  "INVESTMENT",
  "REVENUE",
  "OTHER",
]);

export const FundingSectionEnum = z.enum(["FOUNDER", "LIVE", "PIPELINE"]);

// Literal tuple must mirror FUNDING_STAGES/the Prisma FundingStage enum —
// a schema test asserts these stay in sync.
export const FundingStageEnum = z.enum([
  "PROSPECT",
  "PREPARING",
  "SUBMITTED",
  "IN_REVIEW",
  "AWARDED",
  "REJECTED",
  "WITHDRAWN",
]);

// Optional string fields coming from an HTML form arrive as "" rather than
// absent — treat empty string as "not provided" so email()/url() don't choke.
const emptyToNull = (val: unknown) => (val === "" ? null : val);

const pipelineFields = {
  stage: FundingStageEnum.nullable().optional(),
  probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
  deadline: z.preprocess(emptyToNull, z.coerce.date().nullable().optional()),
  nextAction: z.string().max(500).nullable().optional(),
  nextActionDate: z.preprocess(emptyToNull, z.coerce.date().nullable().optional()),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.preprocess(emptyToNull, z.string().email().nullable().optional()),
  funderUrl: z.preprocess(emptyToNull, httpUrl.nullable().optional()),
};

export const fundingSchema = z.object({
  fundId: z.string().min(1, "Fund ID is required"),
  fundName: z.string().min(1, "Fund name is required"),
  type: FundingTypeEnum,
  section: FundingSectionEnum,
  source: z.string().min(1, "Source is required"),
  date: z.coerce.date().nullable().optional(),
  periodStart: z.coerce.date().nullable().optional(),
  periodEnd: z.coerce.date().nullable().optional(),
  amount: z.coerce.number().nonnegative("Amount must be 0 or greater"),
  currency: z.string().default("GBP"),
  coverageDesc: z.string().max(2000).nullable().optional(),
  projectId: z.string().uuid("Invalid project ID"),
  // Not `.uuid()` — some phases were seeded from a legacy migration with
  // deterministic slug-style IDs (e.g. "<projectId>-phase-0") rather than
  // generated UUIDs, so only require a non-empty string.
  phaseId: z.preprocess(emptyToNull, z.string().min(1, "Invalid phase ID").nullable().optional()),
  verified: z.boolean().default(false),
  notes: z.string().max(2000).nullable().optional(),
  ...pipelineFields,
});

export const fundingUpdateSchema = z.object({
  fundId: z.string().min(1, "Fund ID is required").optional(),
  fundName: z.string().min(1, "Fund name is required").optional(),
  type: FundingTypeEnum.optional(),
  section: FundingSectionEnum.optional(),
  source: z.string().min(1, "Source is required").optional(),
  date: z.coerce.date().nullable().optional(),
  periodStart: z.coerce.date().nullable().optional(),
  periodEnd: z.coerce.date().nullable().optional(),
  amount: z.coerce.number().nonnegative("Amount must be 0 or greater").optional(),
  currency: z.string().optional(),
  coverageDesc: z.string().max(2000).nullable().optional(),
  projectId: z.string().uuid("Invalid project ID").optional(),
  // Not `.uuid()` — some phases were seeded from a legacy migration with
  // deterministic slug-style IDs (e.g. "<projectId>-phase-0") rather than
  // generated UUIDs, so only require a non-empty string.
  phaseId: z.preprocess(emptyToNull, z.string().min(1, "Invalid phase ID").nullable().optional()),
  verified: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  ...pipelineFields,
});

// Minimal schema for the lightweight stage-only PATCH endpoint.
export const fundingStageUpdateSchema = z.object({
  stage: FundingStageEnum,
});

export type FundingInput = z.infer<typeof fundingSchema>;
export type FundingUpdateInput = z.infer<typeof fundingUpdateSchema>;
export type FundingStageUpdateInput = z.infer<typeof fundingStageUpdateSchema>;
