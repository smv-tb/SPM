import { prisma } from "@/lib/prisma";
import { fundingTrancheSchema, fundingTrancheUpdateSchema, fundingTrancheReceiveSchema } from "@/schemas/funding-tranche";
import { summarizeTranches } from "@/lib/funding";
import { HERMES_ACTOR, recordAudit } from "@/lib/audit";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { PATCH_NOTE, diffFields } from "./_shared";

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
        status: { type: "string", enum: ["PENDING", "RECEIVED", "DELAYED"] },
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
              receivedDate: data.receivedDate ?? null, status: data.status, direction: data.direction, milestoneId: data.milestoneId ?? null,
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
        receivedDate: { type: "string" },
        status: { type: "string", enum: ["PENDING", "RECEIVED", "DELAYED"] },
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
        // Moving off RECEIVED drops the receipt date with it — see the matching
        // guard in the PUT route; a stale receivedDate double-counts cash in.
        if (data.status !== undefined && data.status !== "RECEIVED" && data.receivedDate === undefined) {
          data.receivedDate = null;
        }
        const tranche = await prisma.$transaction(async (tx) => {
          const existing = await tx.fundingTranche.findUnique({ where: { id } });
          if (!existing) return null;
          const updated = await tx.fundingTranche.update({ where: { id }, data });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "tranche.update", entityType: "FundingTranche", entityId: id,
            before: existing, after: updated,
          });
          return { ...updated, changes: diffFields(existing, updated) };
        });
        if (!tranche) return createToolResponse({ error: "Tranche not found" });
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
    "Mark a tranche as received",
    { type: "object", properties: { id: { type: "string" }, receivedDate: { type: "string" } }, required: ["id"] },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = fundingTrancheReceiveSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const tranche = await prisma.$transaction(async (tx) => {
          const existing = await tx.fundingTranche.findUnique({ where: { id } });
          if (!existing) return null;
          const updated = await tx.fundingTranche.update({
            where: { id },
            data: { status: "RECEIVED", receivedDate: validation.data.receivedDate ?? new Date() },
          });
          await recordAudit(tx, {
            actor: HERMES_ACTOR, action: "tranche.receive", entityType: "FundingTranche", entityId: id,
            before: existing, after: updated,
          });
          return { ...updated, changes: diffFields(existing, updated) };
        });
        if (!tranche) return createToolResponse({ error: "Tranche not found" });
        return createToolResponse(tranche);
      });
    }
  ));
}
