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
import { productUpdateSchema } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

const withAccount = { incomeAccount: { select: { code: true, name: true } } };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = productUpdateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = validation.data;

  const changes: Prisma.ProductServiceUpdateInput = {};
  if (data.code !== undefined) {
    const code = normaliseProductCode(data.code);
    const codeProblem = validateProductCode(code);
    if (codeProblem) {
      return NextResponse.json({ error: codeProblem, code: "INVALID_CODE" }, { status: 422 });
    }
    changes.code = code;
  }
  if (data.name !== undefined) changes.name = data.name.trim();
  if (data.description !== undefined) changes.description = data.description?.trim() || null;
  if (data.unit !== undefined) changes.unit = data.unit.trim();
  if (data.isArchived !== undefined) changes.isArchived = data.isArchived;
  if (data.unitPrice !== undefined) {
    try {
      changes.unitPrice = fromPence(toPence(data.unitPrice));
    } catch {
      return NextResponse.json({ error: "Not a valid price", code: "INVALID_AMOUNT" }, { status: 422 });
    }
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      const existing = await tx.productService.findUnique({ where: { id } });
      if (!existing) throw new AccountingError("NOT_FOUND", "Item not found", 404);

      if (data.incomeAccountId !== undefined) {
        await assertIncomeAccount(tx, data.incomeAccountId);
        changes.incomeAccount = data.incomeAccountId
          ? { connect: { id: data.incomeAccountId } }
          : { disconnect: true };
      }

      const updated = await tx.productService.update({
        where: { id },
        data: changes,
        include: withAccount,
      });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "product.update",
        entityType: "ProductService",
        entityId: id,
        before: existing,
        after: updated,
        ipAddress: guard.ctx.ipAddress,
      });
      return updated;
    });
    return NextResponse.json(serializeProduct(product));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return booksError(new AccountingError("CODE_TAKEN", "That code is already in use", 409));
    }
    return booksError(error);
  }
});

/**
 * Deleting is for an item created by mistake. Anything that has been invoiced
 * is archived instead, so this takes the settings capability.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:settings");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.productService.findUnique({ where: { id } });
      if (!existing) throw new AccountingError("NOT_FOUND", "Item not found", 404);

      await tx.productService.delete({ where: { id } });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "product.delete",
        entityType: "ProductService",
        entityId: id,
        before: existing,
        ipAddress: guard.ctx.ipAddress,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return booksError(
        new AccountingError(
          "PRODUCT_IN_USE",
          "This item is used on invoices: archive it instead of deleting",
          409
        )
      );
    }
    return booksError(error);
  }
});
