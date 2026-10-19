export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { recordAudit } from "@/lib/audit";
import { actorLabel, alertInBackground } from "@/lib/security-alerts";
import { ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { AccountingError } from "@/lib/accounting/errors";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { lockDateSchema } from "@/schemas/books";

/**
 * The lock date closes the books up to and including that day.
 *
 * Moving it forward is routine housekeeping (`books:close`). Moving it back or
 * clearing it re-opens periods that were treated as final, so it needs
 * `books:reopen` and a written reason, both recorded in the audit log.
 */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  const body = await req.json();
  const validation = lockDateSchema.safeParse(body);
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const { lockDate, reason } = validation.data;

  const current = await prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });
  const next = lockDate ? toLedgerDate(lockDate) : null;
  const isReopening =
    current?.lockDate != null &&
    (next === null || ledgerDateKey(next) < ledgerDateKey(current.lockDate));

  const guard = await requireBooks(req, isReopening ? "books:reopen" : "books:close", { stepUp: isReopening });
  if (!guard.ok) return guard.response;

  try {
    if (isReopening && !reason?.trim()) {
      throw new AccountingError("REASON_REQUIRED", "Re-opening a locked period needs a reason", 422);
    }

    const settings = await prisma.$transaction(async (tx) => {
      const updated = await tx.companySettings.upsert({
        where: { id: COMPANY_SETTINGS_ID },
        update: { lockDate: next },
        create: { id: COMPANY_SETTINGS_ID, lockDate: next },
      });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: isReopening ? "books.reopen" : "books.lock",
        entityType: "CompanySettings",
        entityId: COMPANY_SETTINGS_ID,
        before: { lockDate: current?.lockDate ?? null },
        after: { lockDate: updated.lockDate },
        reason: reason?.trim() || null,
        ipAddress: guard.ctx.ipAddress,
      });
      return updated;
    });

    if (isReopening) {
      alertInBackground({
        event: "books.reopened",
        summary: `The books were re-opened: lock date moved from ${current?.lockDate ? ledgerDateKey(current.lockDate) : "none"} to ${settings.lockDate ? ledgerDateKey(settings.lockDate) : "no lock"}`,
        actor: actorLabel(guard.ctx.actor),
        ipAddress: guard.ctx.ipAddress,
        details: { reason: reason?.trim() ?? null },
      });
    }

    return NextResponse.json({
      lockDate: settings.lockDate ? ledgerDateKey(settings.lockDate) : null,
    });
  } catch (error) {
    return booksError(error);
  }
});
