import { describe, it, expect } from "vitest";
import { taskCreateSchema, taskUpdateSchema } from "@/schemas/task";
import { milestoneUpdateSchema } from "@/schemas/milestone";
import { resourceUpdateSchema } from "@/schemas/resource";
import { customFieldDefinitionUpdateSchema } from "@/schemas/custom-field";
import { livingLabUpdateSchema } from "@/schemas/living-lab";

/**
 * Regression cover: in Zod 4, `.partial()` still fills `.default()` values in
 * for absent keys, so partial updates silently reset status, priority and
 * percentDone. Update schemas must leave absent fields absent.
 */
describe("update schemas are true PATCHes", () => {
  it("task update does not inject status, priority, percentDone or orderIndex", () => {
    expect(taskUpdateSchema.parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
  });

  it("task update still validates the fields that are present", () => {
    expect(taskUpdateSchema.safeParse({ status: "NOPE" }).success).toBe(false);
    expect(taskUpdateSchema.parse({ status: "DONE", percentDone: "40" })).toEqual({ status: "DONE", percentDone: 40 });
  });

  it("task create keeps its defaults", () => {
    const parsed = taskCreateSchema.parse({ milestoneId: "4b9d8a8e-3f0a-4c55-9a51-8f2f1b2c3d4e", title: "New" });
    expect(parsed).toMatchObject({ status: "BACKLOG", priority: "MED", percentDone: 0 });
  });

  it("milestone, resource, custom-field and living-lab updates inject nothing", () => {
    expect(milestoneUpdateSchema.parse({ title: "x" })).toEqual({ title: "x" });
    expect(resourceUpdateSchema.parse({ name: "x" })).toEqual({ name: "x" });
    expect(customFieldDefinitionUpdateSchema.parse({ name: "x" })).toEqual({ name: "x" });
    expect(livingLabUpdateSchema.parse({ name: "x" })).toEqual({ name: "x" });
  });
});

describe("calendar dates accept what reads return", () => {
  it("accepts bare YYYY-MM-DD", () => {
    expect(taskUpdateSchema.parse({ dueDate: "2026-03-31" })).toEqual({ dueDate: "2026-03-31" });
  });

  it("accepts a full ISO timestamp and keeps its date part", () => {
    expect(taskUpdateSchema.parse({ dueDate: "2026-03-31T00:00:00.000Z" })).toEqual({ dueDate: "2026-03-31" });
    expect(milestoneUpdateSchema.parse({ startDate: "2026-01-05T00:00:00Z" })).toEqual({ startDate: "2026-01-05" });
  });

  it("still rejects garbage", () => {
    expect(taskUpdateSchema.safeParse({ dueDate: "31/03/2026" }).success).toBe(false);
  });
});
