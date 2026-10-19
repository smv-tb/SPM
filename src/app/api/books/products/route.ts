export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { recordAudit } from "@/lib/audit";
import { AccountingError } from "@/lib/accounting/errors";
import { assertIncomeAccount } from "@/lib/accounting/products";
import { normaliseProductCode, validateProductCode } from "@/lib/accounting/sales";
import { serializeProduct } from "@/lib/accounting/serialize";
import { fromPence, toPence } from "@/lib/money";
import { productCreateSchema } from "@/schemas/books";

const withAccount = { incomeAccount: { select: { code: true, name: true } } };

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const includeArchived = req.nextUrl.searchParams.get("archived") === "true";
  const products = await prisma.productService.findMany({
    where: includeArchived ? {} : { isArchived: false },
    include: withAccount,
    orderBy: { code: "asc" },
  });

  return NextResponse.json(products.map(serializeProduct));
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = productCreateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  const code = normaliseProductCode(data.code);
  const codeProblem = validateProductCode(code);
  if (codeProblem) {
    return NextResponse.json({ error: codeProblem, code: "INVALID_CODE" }, { status: 422 });
  }

  let unitPrice: string;
  try {
    unitPrice = fromPence(toPence(data.unitPrice ?? 0));
  } catch {
    return NextResponse.json({ error: "Not a valid price", code: "INVALID_AMOUNT" }, { status: 422 });
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      await assertIncomeAccount(tx, data.incomeAccountId);
      const created = await tx.productService.create({
        data: {
          code,
          name: data.name.trim(),
          description: data.description?.trim() || null,
          unit: data.unit.trim(),
          unitPrice,
          incomeAccountId: data.incomeAccountId ?? null,
        },
        include: withAccount,
      });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "product.create",
        entityType: "ProductService",
        entityId: created.id,
        after: created,
        ipAddress: guard.ctx.ipAddress,
      });
      return created;
    });
    return NextResponse.json(serializeProduct(product), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return booksError(
        new AccountingError("CODE_TAKEN", `Code ${code} is already used by another item`, 409)
      );
    }
    return booksError(error);
  }
});
