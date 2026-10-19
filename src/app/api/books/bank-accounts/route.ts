export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { bankPosition, createBankAccount } from "@/lib/accounting/statements";
import { serializeBankAccount } from "@/lib/accounting/serialize";
import { bankAccountCreateSchema } from "@/schemas/books";
import { actorLabel, alertInBackground } from "@/lib/security-alerts";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const accounts = await prisma.bankAccount.findMany({
    orderBy: { name: "asc" },
    include: { ledgerAccount: { select: { code: true, name: true } } },
  });
  const positions = await Promise.all(accounts.map((a) => bankPosition(prisma, a)));
  return NextResponse.json(accounts.map((a, i) => serializeBankAccount(a, positions[i])));
});

/** Setting up a bank account ties it to a ledger account: an Admin's call. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:settings", { stepUp: true });
  if (!guard.ok) return guard.response;

  const validation = bankAccountCreateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  try {
    const account = await prisma.$transaction((tx) => createBankAccount(tx, validation.data, guard.ctx.actor));
    alertInBackground({
      event: "bank.details_changed",
      summary: `A bank account was added: ${account.name}`,
      actor: actorLabel(guard.ctx.actor),
      ipAddress: guard.ctx.ipAddress,
    });
    return NextResponse.json({ id: account.id }, { status: 201 });
  } catch (error) {
    return booksError(error);
  }
});
