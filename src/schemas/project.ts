import { z } from "zod";
import { httpUrl } from "./_helpers";

export const projectUpdateSchema = z.object({
  id: z.string().uuid("Project ID must be a valid UUID"),
  name: z.string().min(1, "Project name is required").max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  logoUrl: httpUrl.max(500).nullable().optional(),
  historicalSpend: z.coerce.number().nonnegative("Historical spend must be 0 or greater").optional(),
}).required({ id: true });

export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
