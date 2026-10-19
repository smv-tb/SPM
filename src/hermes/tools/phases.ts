import { prisma } from "@/lib/prisma";
import { phaseCreateSchema, phaseUpdateSchema, phasesReorderSchema } from "@/schemas/phase";
import { HERMES_ACTOR, recordAudit } from "@/lib/audit";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { DATE_PROP, PATCH_NOTE, diffFields } from "./_shared";

export function registerPhaseTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("phase_list", defineTool(
    "List all phases for a project, ordered by index",
    { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    async ({ projectId }) => {
      return tryCatchTool(async () => {
        const phases = await prisma.phase.findMany({ where: { projectId: String(projectId) }, orderBy: { orderIndex: "asc" } });
        return createToolResponse(phases);
      });
    }
  ));

  handlers.set("phase_get", defineTool(
    "Get a single phase by ID with its milestones",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const phase = await prisma.phase.findUnique({
          where: { id: String(id) },
          include: { milestones: { select: { id: true, code: true, title: true, status: true }, orderBy: { orderIndex: "asc" } } },
        });
        if (!phase) return createToolResponse({ error: "Phase not found" });
        return createToolResponse(phase);
      });
    }
  ));

  handlers.set("phase_create", defineTool(
    "Create a new phase (auto-assigns next orderIndex)",
    {
      type: "object",
      properties: { projectId: { type: "string" }, name: { type: "string" }, color: { type: "string" }, startDate: DATE_PROP, endDate: DATE_PROP },
      required: ["projectId", "name"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = phaseCreateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const maxOrder = await prisma.phase.findFirst({ where: { projectId: data.projectId }, orderBy: { orderIndex: "desc" }, select: { orderIndex: true } });
        const phase = await prisma.phase.create({
          data: { projectId: data.projectId, name: data.name, color: data.color, orderIndex: (maxOrder?.orderIndex ?? -1) + 1, startDate: data.startDate ?? null, endDate: data.endDate ?? null },
        });
        return createToolResponse(phase);
      });
    }
  ));

  handlers.set("phase_update", defineTool(
    `Update a phase. ${PATCH_NOTE}`,
    {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, color: { type: "string" }, startDate: DATE_PROP, endDate: DATE_PROP, orderIndex: { type: "number" } },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = phaseUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const { projectId: _projectId, ...data } = validation.data;
        void _projectId;
        const before = await prisma.phase.findUnique({ where: { id } });
        if (!before) return createToolResponse({ error: "Phase not found" });
        const phase = await prisma.phase.update({ where: { id }, data });
        return createToolResponse({ ...phase, changes: diffFields(before, phase) });
      });
    }
  ));

  handlers.set("phase_delete", defineTool(
    "Delete a phase. Milestones, funding records and cash transactions in it are not deleted — they are left with no phase " +
      "(or moved to `reassignToPhaseId`). The response lists every affected row under `orphaned` / `reassigned`. " +
      "Use `dryRun: true` to see what would be affected without deleting.",
    {
      type: "object",
      properties: {
        id: { type: "string" },
        reassignToPhaseId: { type: "string", description: "Move the phase's milestones, funding records and cash transactions here before deleting" },
        dryRun: { type: "boolean" },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const targetId = args.reassignToPhaseId ? String(args.reassignToPhaseId) : null;
        const phase = await prisma.phase.findUnique({
          where: { id },
          include: {
            milestones: { select: { id: true, code: true, title: true }, orderBy: { orderIndex: "asc" } },
            fundingRecords: { select: { id: true, fundId: true, fundName: true } },
            _count: { select: { cashTransactions: true } },
          },
        });
        if (!phase) return createToolResponse({ error: "Phase not found" });
        if (targetId === id) return createToolResponse({ error: "reassignToPhaseId must be a different phase" });
        if (targetId) {
          const target = await prisma.phase.findUnique({ where: { id: targetId }, select: { projectId: true } });
          if (!target) return createToolResponse({ error: "reassignToPhaseId: phase not found" });
          if (target.projectId !== phase.projectId) return createToolResponse({ error: "reassignToPhaseId must be in the same project" });
        }

        const affected = {
          milestones: phase.milestones,
          fundingRecords: phase.fundingRecords,
          cashTransactions: phase._count.cashTransactions,
        };
        const report = targetId ? { reassigned: { toPhaseId: targetId, ...affected } } : { orphaned: affected };
        const deleted = { id: phase.id, name: phase.name };

        if (args.dryRun === true) return createToolResponse({ dryRun: true, wouldDelete: deleted, ...report });

        await prisma.$transaction(async (tx) => {
          if (targetId) {
            await tx.milestone.updateMany({ where: { phaseId: id }, data: { phaseId: targetId } });
            await tx.cashTransaction.updateMany({ where: { phaseId: id }, data: { phaseId: targetId } });
          }
          // Funding records are money-bearing: each phase change is audited,
          // whether it is a reassignment or the FK's SET NULL on delete.
          const newPhaseId = targetId;
          for (const fr of phase.fundingRecords) {
            const before = await tx.fundingRecord.findUniqueOrThrow({ where: { id: fr.id } });
            const after = await tx.fundingRecord.update({ where: { id: fr.id }, data: { phaseId: newPhaseId } });
            await recordAudit(tx, {
              actor: HERMES_ACTOR, action: "funding.update", entityType: "FundingRecord", entityId: fr.id,
              before, after, reason: `Phase "${phase.name}" deleted`,
            });
          }
          await tx.phase.delete({ where: { id } });
        });

        return createToolResponse({ ok: true, deleted, ...report });
      });
    }
  ));

  handlers.set("phase_reorder", defineTool(
    "Bulk reorder phases by providing an array of { id, orderIndex } pairs",
    {
      type: "object",
      properties: {
        phases: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, orderIndex: { type: "number" } }, required: ["id", "orderIndex"] },
        },
      },
      required: ["phases"],
    },
    async ({ phases }) => {
      return tryCatchTool(async () => {
        const validation = phasesReorderSchema.safeParse(phases);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        await prisma.$transaction(validation.data.map((p) => prisma.phase.update({ where: { id: p.id }, data: { orderIndex: p.orderIndex } })));
        return createToolResponse({ ok: true });
      });
    }
  ));
}
