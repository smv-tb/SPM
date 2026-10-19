import { prisma } from "@/lib/prisma";
import { projectUpdateSchema } from "@/schemas/project";
import { isPrivateUrl } from "@/lib/ssrf";
import { HERMES_ACTOR, recordAudit } from "@/lib/audit";
import { PROJECT_ARCHIVED_MESSAGE } from "@/lib/project-scope";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { DATE_PROP, PATCH_NOTE, diffFields } from "./_shared";

const projectCounts = {
  _count: { select: { phases: true, milestones: true, tasks: true, resources: true, fundingRecords: true, livingLabs: true, tags: true } },
} as const;

// Hermes addresses projects by id without the web route's UUID check, and
// takes the id from the tool argument rather than the body schema.
const hermesProjectUpdateSchema = projectUpdateSchema.omit({ id: true });

export function registerProjectTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("project_list", defineTool(
    "List projects (id, name, dates, archivedAt) with entity counts, oldest first. Archived projects are left out unless includeArchived is true.",
    { type: "object", properties: { includeArchived: { type: "boolean" } } },
    async (args) => {
      return tryCatchTool(async () => {
        const projects = await prisma.project.findMany({
          where: args.includeArchived === true ? {} : { archivedAt: null },
          include: projectCounts,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        return createToolResponse(projects);
      });
    }
  ));

  handlers.set("project_get", defineTool(
    "Get a project by id, with entity counts and historicalSpend. `id` may be omitted only when exactly one active project exists.",
    { type: "object", properties: { id: { type: "string" } } },
    async (args) => {
      return tryCatchTool(async () => {
        if (args.id) {
          const project = await prisma.project.findUnique({ where: { id: String(args.id) }, include: projectCounts });
          if (!project) return createToolResponse({ error: "Project not found" });
          return createToolResponse(project);
        }
        const projects = await prisma.project.findMany({ where: { archivedAt: null }, include: projectCounts, take: 2 });
        if (projects.length === 0) return createToolResponse({ error: "No project found" });
        if (projects.length > 1) {
          const all = await prisma.project.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
          return createToolResponse({ error: "More than one project exists; pass `id`", projects: all });
        }
        return createToolResponse(projects[0]);
      });
    }
  ));

  handlers.set("project_update", defineTool(
    `Update project settings. ${PATCH_NOTE} historicalSpend is spend that predates or falls outside Task/Living Lab ` +
      "tracking; it feeds the funding runway, so changes to it are audited.",
    {
      type: "object",
      properties: {
        id: { type: "string" }, name: { type: "string" }, description: { type: ["string", "null"] },
        startDate: DATE_PROP, endDate: DATE_PROP, logoUrl: { type: ["string", "null"] },
        historicalSpend: { type: "number", description: "GBP, >= 0" },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = hermesProjectUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        if (data.logoUrl && isPrivateUrl(data.logoUrl)) {
          return createToolResponse({ error: "Invalid logoUrl: private or internal URLs are not allowed" });
        }
        const result = await prisma.$transaction(async (tx) => {
          const before = await tx.project.findUnique({ where: { id } });
          if (!before) return null;
          if (before.archivedAt) return { error: PROJECT_ARCHIVED_MESSAGE };
          const after = await tx.project.update({ where: { id }, data });
          if (!before.historicalSpend.equals(after.historicalSpend)) {
            await recordAudit(tx, {
              actor: HERMES_ACTOR, action: "project.historical_spend", entityType: "Project", entityId: id,
              before: { historicalSpend: before.historicalSpend }, after: { historicalSpend: after.historicalSpend },
            });
          }
          return { ...after, changes: diffFields(before, after) };
        });
        if (!result) return createToolResponse({ error: "Project not found" });
        return createToolResponse(result);
      });
    }
  ));
}
