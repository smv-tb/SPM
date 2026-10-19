import { prisma } from "@/lib/prisma";
import { fundingSchema, fundingUpdateSchema } from "@/schemas/funding";
import { computeFundingForecast, computeSecuredCash } from "@/lib/funding";
import { HERMES_ACTOR, recordAudit } from "@/lib/audit";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { parsePagination, paginateResponse, PATCH_NOTE, diffFields } from "./_shared";

const PIPELINE_FIELD_PROPERTIES = {
  stage: { type: "string", enum: ["PROSPECT", "PREPARING", "SUBMITTED", "IN_REVIEW", "AWARDED", "REJECTED", "WITHDRAWN"] },
  probability: { type: "number" },
  deadline: { type: "string" },
  nextAction: { type: "string" },
  nextActionDate: { type: "string" },
  contactName: { type: "string" },
  contactEmail: { type: "string" },
  funderUrl: { type: "string" },
} as const;

export function registerFundingTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("funding_list", defineTool(
    "List funding records grouped by section (FOUNDER, LIVE, PIPELINE)",
    {
      type: "object",
      properties: { cursor: { type: "string" }, limit: { type: "number" }, section: { type: "string" }, summary: { type: "boolean" }, projectId: { type: "string" } },
    },
    async (args) => {
      return tryCatchTool(async () => {
        const where: Record<string, unknown> = {};
        if (args.section) where.section = String(args.section);
        if (args.projectId) where.projectId = String(args.projectId);

        // A summary is a total, so it must be computed over every record, not
        // over one page. It used to be paginated (and to include the +1
        // lookahead row), which quietly reported partial totals as final ones.
        if (args.summary === true) {
          const all = await prisma.fundingRecord.findMany({ where });
          const secured = all.filter(
            (r) => r.verified && (r.section === "FOUNDER" || r.section === "LIVE")
          );
          const pipeline = all.filter((r) => r.section === "PIPELINE");
          const { totalPipeline, weightedForecast } = computeFundingForecast(all);
          return createToolResponse({
            totalSecured: computeSecuredCash(all),
            totalPipeline,
            weightedForecast,
            securedCount: secured.length,
            pipelineCount: pipeline.length,
            recordCount: all.length,
          });
        }

        const { take, cursor, skip } = parsePagination(args);
        const page = await prisma.fundingRecord.findMany({
          where,
          include: { phase: { select: { id: true, name: true } } },
          // `id` breaks createdAt ties, without which cursor paging over
          // bulk-imported records can drop or repeat rows.
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take,
          cursor,
          skip,
        });
        // parsePagination over-fetches by one to detect a next page; that extra
        // row must be trimmed off, and its id handed back as the cursor.
        const { data: records, nextCursor } = paginateResponse(page, take - 1);

        return createToolResponse({
          FOUNDER: records.filter((r) => r.section === "FOUNDER"),
          LIVE: records.filter((r) => r.section === "LIVE"),
          PIPELINE: records.filter((r) => r.section === "PIPELINE"),
          nextCursor,
          hasMore: nextCursor !== null,
        });
      });
    }
  ));

  handlers.set("funding_get", defineTool(
    "Get a single funding record by ID",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const record = await prisma.fundingRecord.findUnique({ where: { id: String(id) }, include: { phase: { select: { id: true, name: true } } } });
        if (!record) return createToolResponse({ error: "Funding record not found" });
        return createToolResponse(record);
      });
    }
  ));

  handlers.set("funding_create", defineTool(
    "Create a new funding record",
    {
      type: "object",
      properties: {
        fundId: { type: "string" }, fundName: { type: "string" },
        type: { type: "string" }, section: { type: "string" }, source: { type: "string" },
        amount: { type: "number" }, projectId: { type: "string" },
        currency: { type: "string" }, date: { type: "string" },
        periodStart: { type: "string" }, periodEnd: { type: "string" },
        coverageDesc: { type: "string" }, phaseId: { type: "string" },
        verified: { type: "boolean" }, notes: { type: "string" },
        ...PIPELINE_FIELD_PROPERTIES,
      },
      required: ["fundId", "fundName", "type", "section", "source", "amount", "projectId"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = fundingSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const record = await prisma.$transaction(async (tx) => {
          const created = await tx.fundingRecord.create({
            data: {
              fundId: data.fundId, fundName: data.fundName, type: data.type, section: data.section, source: data.source,
              amount: data.amount, projectId: data.projectId, currency: data.currency, date: data.date ?? null,
              periodStart: data.periodStart ?? null, periodEnd: data.periodEnd ?? null, coverageDesc: data.coverageDesc ?? null,
              phaseId: data.phaseId ?? null, verified: data.verified, notes: data.notes ?? null,
              stage: data.stage ?? null, probability: data.probability ?? null, deadline: data.deadline ?? null,
              nextAction: data.nextAction ?? null, nextActionDate: data.nextActionDate ?? null,
              contactName: data.contactName ?? null, contactEmail: data.contactEmail ?? null, funderUrl: data.funderUrl ?? null,
            },
          });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "funding.create", entityType: "FundingRecord", entityId: created.id, after: created,
          });
          return created;
        });
        return createToolResponse(record);
      });
    }
  ));

  handlers.set("funding_update", defineTool(
    `Update a funding record. ${PATCH_NOTE}`,
    {
      type: "object",
      properties: {
        id: { type: "string" }, fundId: { type: "string" }, fundName: { type: "string" },
        type: { type: "string" }, section: { type: "string" }, source: { type: "string" },
        amount: { type: "number" }, projectId: { type: "string" }, currency: { type: "string" },
        date: { type: "string" }, periodStart: { type: "string" }, periodEnd: { type: "string" },
        coverageDesc: { type: "string" }, phaseId: { type: "string" },
        verified: { type: "boolean" }, notes: { type: "string" },
        ...PIPELINE_FIELD_PROPERTIES,
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = fundingUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const record = await prisma.$transaction(async (tx) => {
          const existing = await tx.fundingRecord.findUnique({ where: { id } });
          if (!existing) return null;
          const updated = await tx.fundingRecord.update({ where: { id }, data: validation.data });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "funding.update", entityType: "FundingRecord", entityId: id,
            before: existing, after: updated,
          });
          return { ...updated, changes: diffFields(existing, updated) };
        });
        if (!record) return createToolResponse({ error: "Funding record not found" });
        return createToolResponse(record);
      });
    }
  ));

  handlers.set("funding_delete", defineTool(
    "Delete a funding record",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const recordId = String(id);
        const deleted = await prisma.$transaction(async (tx) => {
          // Tranches cascade with the record, so they belong in the snapshot.
          const existing = await tx.fundingRecord.findUnique({ where: { id: recordId }, include: { tranches: true } });
          if (!existing) return false;
          await tx.fundingRecord.delete({ where: { id: recordId } });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "funding.delete", entityType: "FundingRecord", entityId: recordId, before: existing,
          });
          return true;
        });
        if (!deleted) return createToolResponse({ error: "Funding record not found" });
        return createToolResponse({ ok: true });
      });
    }
  ));

  handlers.set("funding_forecast", defineTool(
    "Get the weighted fundraising forecast: weighted total, per-stage totals/counts, upcoming deadlines (14d), and overdue next-actions. Pass projectId for one project; without it, every project.",
    { type: "object", properties: { projectId: { type: "string" } } },
    async (args) => {
      return tryCatchTool(async () => {
        const records = await prisma.fundingRecord.findMany({
          where: args.projectId ? { projectId: String(args.projectId) } : {},
          orderBy: { createdAt: "asc" },
        });
        return createToolResponse(computeFundingForecast(records));
      });
    }
  ));
}
