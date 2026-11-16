import { z } from "zod";

export const FundingTrancheStatusEnum = z.enum(["PENDING", "RECEIVED", "DELAYED"]);
export const TrancheDirectionEnum = z.enum(["INCOMING", "OUTGOING"]);
// What create and update may set. RECEIVED (and the receipt date) only comes
// from the receive action, which refuses a tranche already received (F-11).
export const TrancheOpenStatusEnum = z.enum(["PENDING", "DELAYED"]);

export const fundingTrancheSchema = z.object({
  // Not `.uuid()` — funding records seeded by the ODS migration have
  // deterministic composite IDs (e.g. "<projectId>-F001") rather than generated
  // UUIDs, so requiring a UUID here rejected every tranche on a migrated record.
  // Same reasoning as `phaseId` in schemas/funding.ts.
  fundingRecordId: z.string().min(1, "Invalid funding record ID"),
  label: z.string().min(1, "Label is required"),
  amount: z.coerce.number().nonnegative("Amount must be 0 or greater"),
  dueDate: z.coerce.date(),
  status: TrancheOpenStatusEnum.default("PENDING"),
  direction: TrancheDirectionEnum.default("INCOMING"),
  milestoneId: z.string().uuid("Invalid milestone ID").nullable().optional(),
});

export const fundingTrancheUpdateSchema = z.object({
  label: z.string().min(1, "Label is required").optional(),
  amount: z.coerce.number().nonnegative("Amount must be 0 or greater").optional(),
  dueDate: z.coerce.date().optional(),
  status: TrancheOpenStatusEnum.optional(),
  direction: TrancheDirectionEnum.optional(),
  milestoneId: z.string().uuid("Invalid milestone ID").nullable().optional(),
});

// "Mark received" action — defaults receivedDate to now when omitted.
export const fundingTrancheReceiveSchema = z.object({
  receivedDate: z.coerce.date().optional(),
});

export type FundingTrancheInput = z.infer<typeof fundingTrancheSchema>;
export type FundingTrancheUpdateInput = z.infer<typeof fundingTrancheUpdateSchema>;
export type FundingTrancheReceiveInput = z.infer<typeof fundingTrancheReceiveSchema>;
