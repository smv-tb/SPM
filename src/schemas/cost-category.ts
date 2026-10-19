import { z } from "zod";

export const costCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const costCategoryUpdateSchema = costCategorySchema.partial();

export type CostCategoryInput = z.infer<typeof costCategorySchema>;
export type CostCategoryUpdateInput = z.infer<typeof costCategoryUpdateSchema>;
