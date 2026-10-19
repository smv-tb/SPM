export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { stepUpGuard } from "@/lib/mfa/step-up";
import { updateBankAccount } from "@/lib/accounting/statements";
import { bankAccountUpdateSchema } from "@/schemas/books";
import { actorLabel, alertInBackground } from "@/lib/security-alerts";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:settings");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = bankAccountUpdateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  // Renaming an account is routine; changing where the money goes is not.
  if (validation.data.sortCode !== undefined || validation.data.accountNumber !== undefined) {
    const refusal = await stepUpGuard(guard.ctx.session);
    if (refusal) return refusal;
  }

  try {
    const account = await prisma.$transaction((tx) => updateBankAccount(tx, id, validation.data, guard.ctx.actor));
    if (account.detailsChanged) {
      alertInBackground({
        event: "bank.details_changed",
        summary: `The sort code or account number of bank account "${account.name}" was changed`,
        actor: actorLabel(guard.ctx.actor),
        ipAddress: guard.ctx.ipAddress,
      });
    }
    return NextResponse.json({ id: account.id });
  } catch (error) {
    return booksError(error);
  }
});
