export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { recordAudit } from "@/lib/audit";
import { validateAccountCode } from "@/lib/accounting/chart";
import { AccountingError } from "@/lib/accounting/errors";
import { accountCreateSchema } from "@/schemas/books";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const includeArchived = params.get("archived") === "true";
  const type = params.get("type");

  const accounts = await prisma.ledgerAccount.findMany({
    where: {
      ...(includeArchived ? {} : { isArchived: false }),
      ...(type ? { type: type as Prisma.EnumLedgerAccountTypeFilter["equals"] } : {}),
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(accounts);
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = accountCreateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  // Codes are grouped by type so reports order predictably.
  const codeProblem = validateAccountCode(data.code, data.type);
  if (codeProblem) {
    return NextResponse.json({ error: codeProblem, code: "INVALID_CODE" }, { status: 422 });
  }

  try {
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.ledgerAccount.create({
        data: {
          code: data.code,
          name: data.name,
          type: data.type,
          description: data.description ?? null,
        },
      });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "account.create",
        entityType: "LedgerAccount",
        entityId: created.id,
        after: created,
        ipAddress: guard.ctx.ipAddress,
      });
      return created;
    });
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return booksError(
        new AccountingError("CODE_TAKEN", `Account code ${data.code} is already in use`, 409)
      );
    }
    return booksError(error);
  }
});
