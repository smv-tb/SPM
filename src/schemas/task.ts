import { z } from "zod";
import { TaskStatusEnum, PriorityEnum } from "./milestone";
import { calendarDate, partialUpdate } from "./_helpers";

/** Base object schema with no refinements — allows .partial() for update */
const taskBaseSchema = z.object({
  milestoneId: z.string().uuid("Invalid milestone ID"),
  projectId: z.string().uuid().optional(),
  code: z.string().min(1).max(20).optional(),
  title: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  startDate: calendarDate.optional(),
  dueDate: calendarDate.optional(),
  percentDone: z.coerce.number().int().min(0).max(100).default(0),
  status: TaskStatusEnum.default("BACKLOG"),
  priority: PriorityEnum.default("MED"),
  estBudget: z.coerce.number().nonnegative().nullable().optional(),
  actualSpend: z.coerce.number().nonnegative().nullable().optional(),
  extCosts: z.coerce.number().nonnegative().nullable().optional(),
  costCategoryId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  ownerIds: z.array(z.string().uuid()).optional(),
  resourceId: z.string().nullable().optional(),
  createLivingLabCost: z.boolean().optional(),
  orderIndex: z.coerce.number().int().default(0),
});

/**
 * API input schema — accepts ISO date strings from request bodies.
 */
export const taskCreateSchema = taskBaseSchema.refine(
  (data) => {
    if (data.startDate && data.dueDate) {
      return data.startDate <= data.dueDate;
    }
    return true;
  },
  { message: "Start date must be before or equal to due date", path: ["dueDate"] }
);

/**
 * API update schema — all fields optional, allows partial updates. Absent
 * fields stay absent (no defaults), so a PATCH only writes what it names.
 * Includes `updatedAt` for optimistic concurrency control.
 */
export const taskUpdateSchema = partialUpdate(taskBaseSchema).extend({
  updatedAt: z.string().optional(),
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export { TaskStatusEnum, PriorityEnum };

// Backward compatibility alias
export const taskSchema = taskCreateSchema;
export type TaskInput = z.infer<typeof taskSchema>;
