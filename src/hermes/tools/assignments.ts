import { prisma } from "@/lib/prisma";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";

export function registerAssignmentTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("task_assignment_link", defineTool(
    "Assign a user to a task with a role",
    { type: "object", properties: { taskId: { type: "string" }, userId: { type: "string" }, role: { type: "string" } }, required: ["taskId", "userId"] },
    async (args) => {
      return tryCatchTool(async () => {
        const role = args.role === "COLLABORATOR" ? "COLLABORATOR" : "OWNER" as const;
        const assignment = await prisma.taskAssignment.create({ data: { taskId: String(args.taskId), userId: String(args.userId), role } });
        return createToolResponse(assignment);
      });
    }
  ));

  handlers.set("task_assignment_unlink", defineTool(
    "Remove a user's assignment from a task",
    { type: "object", properties: { taskId: { type: "string" }, userId: { type: "string" } }, required: ["taskId", "userId"] },
    async (args) => {
      return tryCatchTool(async () => {
        await prisma.taskAssignment.deleteMany({ where: { taskId: String(args.taskId), userId: String(args.userId) } });
        return createToolResponse({ ok: true });
      });
    }
  ));

  handlers.set("resource_milestone_link", defineTool(
    "Link a resource to a milestone",
    { type: "object", properties: { resourceId: { type: "string" }, milestoneId: { type: "string" } }, required: ["resourceId", "milestoneId"] },
    async (args) => {
      return tryCatchTool(async () => {
        const link = await prisma.resourceMilestone.create({ data: { resourceId: String(args.resourceId), milestoneId: String(args.milestoneId) } });
        return createToolResponse(link);
      });
    }
  ));

  handlers.set("resource_milestone_unlink", defineTool(
    "Remove a resource-milestone link",
    { type: "object", properties: { resourceId: { type: "string" }, milestoneId: { type: "string" } }, required: ["resourceId", "milestoneId"] },
    async (args) => {
      return tryCatchTool(async () => {
        await prisma.resourceMilestone.deleteMany({ where: { resourceId: String(args.resourceId), milestoneId: String(args.milestoneId) } });
        return createToolResponse({ ok: true });
      });
    }
  ));

  handlers.set("tag_attach", defineTool(
    "Attach a tag to a task, milestone, or resource",
    { type: "object", properties: { entityType: { type: "string" }, entityId: { type: "string" }, tagId: { type: "string" } }, required: ["entityType", "entityId", "tagId"] },
    async (args) => {
      return tryCatchTool(async () => {
        const eid = String(args.entityId);
        const tid = String(args.tagId);
        switch (args.entityType) {
          case "task": await prisma.taskTag.create({ data: { taskId: eid, tagId: tid } }); break;
          case "milestone": await prisma.milestoneTag.create({ data: { milestoneId: eid, tagId: tid } }); break;
          case "resource": await prisma.resourceTag.create({ data: { resourceId: eid, tagId: tid } }); break;
          default: return createToolResponse({ error: "Invalid entityType. Use: task, milestone, or resource" });
        }
        return createToolResponse({ ok: true });
      });
    }
  ));

  handlers.set("tag_detach", defineTool(
    "Remove a tag from a task, milestone, or resource",
    { type: "object", properties: { entityType: { type: "string" }, entityId: { type: "string" }, tagId: { type: "string" } }, required: ["entityType", "entityId", "tagId"] },
    async (args) => {
      return tryCatchTool(async () => {
        const eid = String(args.entityId);
        const tid = String(args.tagId);
        switch (args.entityType) {
          case "task": await prisma.taskTag.deleteMany({ where: { taskId: eid, tagId: tid } }); break;
          case "milestone": await prisma.milestoneTag.deleteMany({ where: { milestoneId: eid, tagId: tid } }); break;
          case "resource": await prisma.resourceTag.deleteMany({ where: { resourceId: eid, tagId: tid } }); break;
          default: return createToolResponse({ error: "Invalid entityType. Use: task, milestone, or resource" });
        }
        return createToolResponse({ ok: true });
      });
    }
  ));
}
