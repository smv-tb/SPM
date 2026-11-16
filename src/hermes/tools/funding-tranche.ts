import { prisma } from "@/lib/prisma";
import { fundingTrancheSchema, fundingTrancheUpdateSchema, fundingTrancheReceiveSchema } from "@/schemas/funding-tranche";
import { summarizeTranches } from "@/lib/funding";
import { HERMES_ACTOR, recordAudit } from "@/lib/audit";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { PATCH_NOTE, diffFields } from "./_shared";
import { ALREADY_RECEIVED, RECEIVABLE_STATUSES, receiveTranche } from "@/lib/funding-tranches";

export function registerFundingTrancheTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("tranche_list", defineTool(
    "List tranches for a funding record, with a received/total summary broken down by direction (INCOMING receipts vs OUTGOING repayments)",
    { type: "object", properties: { fundingRecordId: { type: "string" } }, required: ["fundingRecordId"] },
    async ({ fundingRecordId }) => {
      return tryCatchTool(async () => {
        const tranches = await prisma.fundingTranche.findMany({
          where: { fundingRecordId: String(fundingRecordId) },
          orderBy: { dueDate: "asc" },
        });
        return createToolResponse({ tranches, summary: summarizeTranches(tranches) });
      });
    }
  ));

  handlers.set("tranche_create", defineTool(
    "Create a new tranche under a funding record — INCOMING for a grant/loan installment still to be received, OUTGOING for a repayment still to be paid back (e.g. a director's loan refund)",
    {
      type: "object",
      properties: {
        fundingRecordId: { type: "string" },
        label: { type: "string" },
        amount: { type: "number" },
        dueDate: { type: "string" },
        status: { type: "string", enum: ["PENDING", "DELAYED"], description: "Use tranche_receive to mark it received" },
        direction: { type: "string", enum: ["INCOMING", "OUTGOING"] },
        milestoneId: { type: "string" },
      },
      required: ["fundingRecordId", "label", "amount", "dueDate"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = fundingTrancheSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        const existing = await prisma.fundingRecord.findUnique({ where: { id: data.fundingRecordId } });
        if (!existing) return createToolResponse({ error: "Funding record not found" });
        const tranche = await prisma.$transaction(async (tx) => {
          const created = await tx.fundingTranche.create({
            data: {
              fundingRecordId: data.fundingRecordId, label: data.label, amount: data.amount, dueDate: data.dueDate,
              status: data.status, direction: data.direction, milestoneId: data.milestoneId ?? null,
            },
          });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "tranche.create", entityType: "FundingTranche", entityId: created.id, after: created,
          });
          return created;
        });
        return createToolResponse(tranche);
      });
    }
  ));

  handlers.set("tranche_update", defineTool(
    `Update a tranche's fields. ${PATCH_NOTE}`,
    {
      type: "object",
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        amount: { type: "number" },
        dueDate: { type: "string" },
        status: { type: "string", enum: ["PENDING", "DELAYED"], description: "Refused once the tranche is received" },
        direction: { type: "string", enum: ["INCOMING", "OUTGOING"] },
        milestoneId: { type: "string" },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = fundingTrancheUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const data = validation.data;
        // Same rule as the PUT route: a received tranche's status is final here.
        const tranche = await prisma.$transaction(async (tx) => {
          const existing = await tx.fundingTranche.findUnique({ where: { id } });
          if (!existing) return null;
          if (data.status !== undefined && existing.status === "RECEIVED") return "received" as const;
          const { count } = await tx.fundingTranche.updateMany({
            where: data.status !== undefined ? { id, status: { in: [...RECEIVABLE_STATUSES] } } : { id },
            data,
          });
          if (count === 0) return "received" as const;
          const updated = await tx.fundingTranche.findUniqueOrThrow({ where: { id } });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "tranche.update", entityType: "FundingTranche", entityId: id,
            before: existing, after: updated,
          });
          return { ...updated, changes: diffFields(existing, updated) };
        });
        if (!tranche) return createToolResponse({ error: "Tranche not found" });
        if (tranche === "received") return createToolResponse(ALREADY_RECEIVED);
        return createToolResponse(tranche);
      });
    }
  ));

  handlers.set("tranche_delete", defineTool(
    "Delete a tranche (funding:delete capability — PM+). Reports the deleted row in the audit trail.",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const deleted = await prisma.$transaction(async (tx) => {
          const existing = await tx.fundingTranche.findUnique({ where: { id } });
          if (!existing) return null;
          await tx.fundingTranche.delete({ where: { id } });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "tranche.delete", entityType: "FundingTranche", entityId: id, before: existing,
          });
          return existing;
        });
        if (!deleted) return createToolResponse({ error: "Tranche not found" });
        return createToolResponse({ ok: true, deleted });
      });
    }
  ));

  handlers.set("tranche_receive", defineTool(
    "Mark a tranche as received. Once only: a tranche already received is refused (ALREADY_RECEIVED), so its receipt date cannot be moved.",
    { type: "object", properties: { id: { type: "string" }, receivedDate: { type: "string" } }, required: ["id"] },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = fundingTrancheReceiveSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const result = await prisma.$transaction(async (tx) => {
          const outcome = await receiveTranche(tx, id, validation.data.receivedDate ?? new Date());
          if (outcome.kind === "received") {
            await recordAudit(tx, {
              actor: HERMES_ACTOR, action: "tranche.receive", entityType: "FundingTranche", entityId: id,
              before: outcome.before, after: outcome.after,
            });
          }
          return outcome;
        });
        if (result.kind === "not_found") return createToolResponse({ error: "Tranche not found" });
        if (result.kind === "already_received") return createToolResponse(ALREADY_RECEIVED);
        return createToolResponse({ ...result.after, changes: diffFields(result.before, result.after) });
      });
    }
  ));
}
