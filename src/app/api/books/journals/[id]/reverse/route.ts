export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { toLedgerDate } from "@/lib/accounting/dates";
import { reverseJournal } from "@/lib/accounting/posting";
import { enforceSeparation } from "@/lib/accounting/separation";
import { recordAudit } from "@/lib/audit";
import { serializeEntry } from "@/lib/accounting/serialize";
import { journalReverseSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Corrects a posted journal by posting its mirror image. The original is
 * untouched — that is what makes the ledger trustworthy.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = journalReverseSchema.safeParse(await req.json().catch(() => ({})));
  if (!validation.success) return invalidRequest(validation.error.flatten());

  try {
    const reversal = await prisma.$transaction(async (tx) => {
      // Enforced here, not inside reverseJournal: voiding an invoice, credit note or payment reverses
      // its journal through the same function, and whoever approved one must still be able to void it.
      const original = await tx.journalEntry.findUnique({ where: { id }, select: { createdById: true, postedById: true } });
      if (original) {
        const { selfApproved } = await enforceSeparation(
          tx, { thing: "journal", verb: "reverse" }, (guard.ctx.session.user as { id?: string }).id ?? null,
          [original.createdById, original.postedById]
        );
        if (selfApproved) {
          await recordAudit(tx, {
            actor: guard.ctx.actor, action: "journal.reverse_self", entityType: "JournalEntry", entityId: id,
            after: { selfApproved: true }, ipAddress: guard.ctx.ipAddress,
          });
        }
      }
      return reverseJournal(
        tx,
        id,
        { date: toLedgerDate(validation.data.date), memo: validation.data.memo ?? null },
        guard.ctx.actor
      );
    });
    const full = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: reversal.id },
      include: {
        lines: { orderBy: { lineNumber: "asc" }, include: { account: { select: { code: true, name: true } } } },
      },
    });
    return NextResponse.json(serializeEntry(full), { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
