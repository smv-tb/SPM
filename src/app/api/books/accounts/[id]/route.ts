export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { recordAudit } from "@/lib/audit";
import { validateAccountCode } from "@/lib/accounting/chart";
import { AccountingError } from "@/lib/accounting/errors";
import { accountUpdateSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const { id } = await params;
  const body = await req.json();

  const validation = accountUpdateSchema.safeParse(body);
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  // Renaming is everyday bookkeeping; archiving or restructuring the chart is
  // not, so it takes the settings capability.
  const structural = data.isArchived !== undefined || data.code !== undefined || data.type !== undefined;
  const guard = await requireBooks(req, structural ? "books:settings" : "books:post");
  if (!guard.ok) return guard.response;

  try {
    const account = await prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerAccount.findUnique({ where: { id } });
      if (!existing) throw new AccountingError("NOT_FOUND", "Account not found", 404);

      const code = data.code ?? existing.code;
      const type = data.type ?? existing.type;
      const codeProblem = validateAccountCode(code, type);
      if (codeProblem) throw new AccountingError("INVALID_CODE", codeProblem, 422);

      // These are also enforced by trigger; checked here so the message is useful.
      if (existing.isSystem && (data.code !== undefined || data.type !== undefined || data.isArchived === true)) {
        throw new AccountingError(
          "SYSTEM_ACCOUNT",
          `${existing.code} is a system account: it can be renamed, but not recoded, retyped or archived`,
          409
        );
      }
      if (data.type !== undefined && data.type !== existing.type) {
        const postings = await tx.journalLine.count({ where: { accountId: id } });
        if (postings > 0) {
          throw new AccountingError(
            "ACCOUNT_IN_USE",
            "This account has postings, so changing its type would move history between the P&L and the balance sheet",
            409
          );
        }
      }

      const updated = await tx.ledgerAccount.update({ where: { id }, data });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "account.update",
        entityType: "LedgerAccount",
        entityId: id,
        before: existing,
        after: updated,
        ipAddress: guard.ctx.ipAddress,
      });
      return updated;
    });
    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return booksError(new AccountingError("CODE_TAKEN", "That account code is already in use", 409));
    }
    return booksError(error);
  }
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:settings");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerAccount.findUnique({ where: { id } });
      if (!existing) throw new AccountingError("NOT_FOUND", "Account not found", 404);
      if (existing.isSystem) {
        throw new AccountingError("SYSTEM_ACCOUNT", `${existing.code} is a system account and cannot be deleted`, 409);
      }

      // An account that has been used is archived, never deleted — deleting it
      // would orphan posted history.
      const postings = await tx.journalLine.count({ where: { accountId: id } });
      if (postings > 0) {
        throw new AccountingError(
          "ACCOUNT_IN_USE",
          "This account has postings: archive it instead of deleting it",
          409
        );
      }

      await tx.ledgerAccount.delete({ where: { id } });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "account.delete",
        entityType: "LedgerAccount",
        entityId: id,
        before: existing,
        ipAddress: guard.ctx.ipAddress,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
