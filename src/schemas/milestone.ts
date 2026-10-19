import { z } from "zod";
import { calendarDate, partialUpdate } from "./_helpers";

export const MilestoneStatusEnum = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETE",
  "BLOCKED",
  "ON_HOLD",
]);

export const PriorityEnum = z.enum(["HIGH", "MED", "LOW"]);

export const TaskStatusEnum = z.enum([
  "BACKLOG",
  "IN_PROGRESS",
  "DONE",
  "BLOCKED",
  "ON_HOLD",
  "OVERDUE",
]);

/** Base object schema with no refinements — allows .partial() for update */
const milestoneBaseSchema = z.object({
  code: z.string().min(1).max(20, "Code is too long"),
  title: z.string().min(1).max(255, "Title is too long"),
  projectId: z.string().uuid("Invalid project ID"),
  phaseId: z.string().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  startDate: calendarDate.optional(),
  dueDate: calendarDate.optional(),
  status: MilestoneStatusEnum.default("NOT_STARTED"),
  priority: PriorityEnum.default("MED"),
  estBudget: z.coerce.number().nonnegative().nullable().optional(),
  actualSpend: z.coerce.number().nonnegative().nullable().optional(),
  orderIndex: z.coerce.number().int().optional(),
});

/** API input schema — uses string dates for clean YYYY-MM-DD validation */
export const milestoneCreateSchema = milestoneBaseSchema.refine(
  (data) => {
    if (data.startDate && data.dueDate) {
      return data.startDate <= data.dueDate;
    }
    return true;
  },
  { message: "Start date must be before or equal to due date", path: ["dueDate"] }
);

export const milestoneUpdateSchema = partialUpdate(milestoneBaseSchema).extend({
  updatedAt: z.string().optional(),
});

export type MilestoneCreateInput = z.infer<typeof milestoneCreateSchema>;
export type MilestoneUpdateInput = z.infer<typeof milestoneUpdateSchema>;

// Backward compatibility alias
export const milestoneSchema = milestoneCreateSchema;
export type MilestoneInput = z.infer<typeof milestoneSchema>;
