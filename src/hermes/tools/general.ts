import { prisma } from "@/lib/prisma";
import { HERMES_RATE_LIMIT } from "@/lib/rate-limit";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { MAX_BULK_ITEMS } from "./_shared";

/** Lower-case alphanumerics only, so "M1.3-T01", "m1.3 t01" and "M13T01" compare equal. */
export function normalizeCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The milestone part of a task-style code: "M1.3-T01" → "M1.3". Null when there is no separator. */
export function codePrefix(value: string): string | null {
  const match = /^(.+?)[\s_-]+T?\d+$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function registerGeneralTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("hermes_health", defineTool(
    "Check database connectivity and Hermes agent status. Also reports the rate limit and write conventions.",
    { type: "object", properties: {} },
    async () => {
      return tryCatchTool(async () => {
        await prisma.$queryRaw`SELECT 1`;
        return createToolResponse({
          status: "ok",
          timestamp: new Date().toISOString(),
          limits: {
            requestsPerWindow: HERMES_RATE_LIMIT.max,
            windowSeconds: HERMES_RATE_LIMIT.windowMs / 1000,
            scope: "per client IP, all /api/hermes requests; one tool call = one request",
            onExceeded: "HTTP 429, JSON-RPC error -32029, Retry-After = seconds left in the window",
            maxBulkItems: MAX_BULK_ITEMS,
          },
          conventions: {
            updates: "PATCH — only fields present are written; response includes `changes`",
            dates: "write YYYY-MM-DD (ISO timestamps accepted, date part used); reads return ISO",
          },
        });
      });
    }
  ));

  handlers.set("hermes_search", defineTool(
    "Cross-entity search across tasks, milestones, phases, living labs, funding records, resources and users. " +
      "Matches titles/names case-insensitively and codes ignoring punctuation (\"m13t04\" finds M1.3-T04). " +
      "When nothing matches it returns `nearMatches` (e.g. other tasks under the same milestone code) and a `hint`.",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text, e.g. a task code like M1.3-T01 or a word from a title" },
        limit: { type: "number", description: "Max results per entity (default 5, max 20)" },
      },
      required: ["query"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const q = String(args.query ?? args.search ?? "").trim();
        if (!q) return createToolResponse({ error: "query is required" });
        const l = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20);
        const norm = normalizeCode(q);
        const taskSelect = { id: true, code: true, title: true, status: true, milestone: { select: { code: true } } } as const;

        const [taskIdsByCode, milestoneIdsByCode] = norm
          ? await Promise.all([
              prisma.$queryRaw<{ id: string }[]>`SELECT id FROM tasks WHERE regexp_replace(lower(code), '[^a-z0-9]', '', 'g') LIKE ${"%" + norm + "%"} LIMIT ${l}`,
              prisma.$queryRaw<{ id: string }[]>`SELECT id FROM milestones WHERE regexp_replace(lower(code), '[^a-z0-9]', '', 'g') LIKE ${"%" + norm + "%"} LIMIT ${l}`,
            ])
          : [[], []];

        const [tasks, milestones, phases, livingLabs, fundingRecords, resources, users] = await Promise.all([
          prisma.task.findMany({
            where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { id: { in: taskIdsByCode.map((r) => r.id) } }] },
            take: l, select: taskSelect, orderBy: { code: "asc" },
          }),
          prisma.milestone.findMany({
            where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { id: { in: milestoneIdsByCode.map((r) => r.id) } }] },
            take: l, select: { id: true, code: true, title: true, status: true }, orderBy: { code: "asc" },
          }),
          prisma.phase.findMany({ where: { name: { contains: q, mode: "insensitive" } }, take: l, select: { id: true, name: true } }),
          prisma.livingLab.findMany({
            where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] },
            take: l, select: { id: true, name: true, location: true },
          }),
          prisma.fundingRecord.findMany({
            where: { OR: [{ fundId: { contains: q, mode: "insensitive" } }, { fundName: { contains: q, mode: "insensitive" } }, { source: { contains: q, mode: "insensitive" } }] },
            take: l, select: { id: true, fundId: true, fundName: true, section: true, stage: true },
          }),
          prisma.resource.findMany({
            where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { role: { contains: q, mode: "insensitive" } }] },
            take: l, select: { id: true, name: true, role: true },
          }),
          prisma.user.findMany({
            where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
            take: l, select: { id: true, name: true, email: true, role: true },
          }),
        ]);

        const result: Record<string, unknown> = { tasks, milestones, phases, livingLabs, fundingRecords, resources, users };
        const empty = [tasks, milestones, phases, livingLabs, fundingRecords, resources, users].every((r) => r.length === 0);
        if (empty) {
          // A code that doesn't exist — typically a task that was renumbered or
          // deleted. Offer what does exist under the same milestone prefix.
          const prefix = codePrefix(q);
          const nearMatches = prefix
            ? await prisma.task.findMany({
                where: { OR: [{ code: { startsWith: `${prefix}-`, mode: "insensitive" } }, { milestone: { code: { equals: prefix, mode: "insensitive" } } }] },
                take: 20, select: taskSelect, orderBy: { code: "asc" },
              })
            : [];
          result.nearMatches = nearMatches;
          result.hint = nearMatches.length > 0
            ? `No exact match for "${q}". These tasks exist under "${prefix}" — the code may have been renumbered or deleted.`
            : `No match for "${q}" in any entity. Codes are matched ignoring punctuation; try a title word, or task_list with milestoneId.`;
        }
        return createToolResponse(result);
      });
    }
  ));

  const PROJECT_COUNTS = {
    _count: { select: { phases: true, milestones: true, tasks: true, resources: true, fundingRecords: true, livingLabs: true } },
  } as const;

  // Kept under its old name so existing clients keep working; with several
  // projects it needs a projectId (see project_list).
  handlers.set("hermes_project_first", defineTool(
    "Get one project with entity counts: the given projectId, or the oldest active project when there is only one",
    { type: "object", properties: { projectId: { type: "string" } } },
    async (args) => {
      return tryCatchTool(async () => {
        if (args.projectId) {
          const project = await prisma.project.findUnique({ where: { id: String(args.projectId) }, include: PROJECT_COUNTS });
          if (!project) return createToolResponse({ error: "Project not found" });
          return createToolResponse(project);
        }
        const projects = await prisma.project.findMany({
          where: { archivedAt: null },
          include: PROJECT_COUNTS,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 2,
        });
        if (projects.length === 0) return createToolResponse({ error: "No project found. Create one first." });
        if (projects.length > 1) {
          return createToolResponse({ error: "There are several projects; pass a projectId (see project_list)." });
        }
        return createToolResponse(projects[0]);
      });
    }
  ));
}
