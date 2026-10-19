import { z } from "zod";

export const phaseCreateSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  name: z.string().min(1, "Name is required"),
  color: z.string().optional(),
  orderIndex: z.coerce.number().int().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
});

export const phaseUpdateSchema = phaseCreateSchema.partial();

export const phasesReorderSchema = z.array(
  z.object({
    // Not .uuid(): phases seeded by scripts/parse-ods.ts carry legacy IDs.
    id: z.string().min(1, "Phase ID is required"),
    orderIndex: z.coerce.number().int().nonnegative("Order index must be non-negative"),
  })
);

export type PhaseCreateInput = z.infer<typeof phaseCreateSchema>;
export type PhaseUpdateInput = z.infer<typeof phaseUpdateSchema>;
export type PhasesReorderInput = z.infer<typeof phasesReorderSchema>;
