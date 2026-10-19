import { z } from "zod";
import { partialUpdate } from "./_helpers";

export const livingLabCostCreateSchema = z.object({
  costCategoryId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  estBudget: z.coerce.number().nonnegative().default(0),
  actualSpend: z.coerce.number().nonnegative().default(0),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type LivingLabCostCreateInput = z.infer<typeof livingLabCostCreateSchema>;

export const livingLabCostUpdateSchema = z.object({
  costCategoryId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  estBudget: z.coerce.number().nonnegative().optional(),
  actualSpend: z.coerce.number().nonnegative().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).partial();

export type LivingLabCostUpdateInput = z.infer<typeof livingLabCostUpdateSchema>;

export const livingLabCreateSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  name: z.string().min(1, "Name is required").max(255),
  location: z.string().max(255).nullable().optional(),
  totalBudget: z.coerce.number().nonnegative().default(0),
});

export const livingLabUpdateSchema = partialUpdate(livingLabCreateSchema).omit({ projectId: true });

export type LivingLabCreateInput = z.infer<typeof livingLabCreateSchema>;
export type LivingLabUpdateInput = z.infer<typeof livingLabUpdateSchema>;
