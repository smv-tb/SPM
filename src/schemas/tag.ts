import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #6366f1");

export const tagCreateSchema = z.object({
  projectId: z.string().min(1, "projectId is required").max(100),
  name: z.string().trim().min(1, "Name is required").max(100),
  color: hexColor.optional(),
});

export const tagUpdateSchema = z
  .object({ name: z.string().trim().min(1, "Name is required").max(100).optional(), color: hexColor.optional() })
  .refine((v) => v.name !== undefined || v.color !== undefined, "Nothing to change");
