import { z } from "zod";
import { partialUpdate } from "./_helpers";

export const ResourceTypeEnum = z.enum(["CORE", "PARTNER", "HIRING"]);

export const ResourceStatusEnum = z.enum(["ACTIVE", "BLOCKED", "INACTIVE"]);

export const resourceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.string().min(1, "Role is required"),
  projectId: z.string().uuid("Invalid project ID"),
  department: z.string().nullable().optional(),
  type: ResourceTypeEnum.default("CORE"),
  availability: z.string().nullable().optional(),
  dayRate: z.coerce.number().nonnegative().nullable().optional(),
  daysPerMonth: z.coerce.number().int().nonnegative().nullable().optional(),
  yearlyCost: z.coerce.number().nonnegative().nullable().optional(),
  status: ResourceStatusEnum.default("ACTIVE"),
  notes: z.string().max(2000).nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  milestoneIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

export const resourceUpdateSchema = partialUpdate(resourceSchema);

export type ResourceInput = z.infer<typeof resourceSchema>;
export type ResourceUpdateInput = z.infer<typeof resourceUpdateSchema>;
