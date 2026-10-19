export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { recordAudit } from "@/lib/audit";
import { auditableContact } from "@/lib/accounting/privacy";
import { AccountingError } from "@/lib/accounting/errors";
import { normaliseAddress } from "@/lib/accounting/sales";
import { contactCreateSchema, type ContactCreateInput } from "@/schemas/books";

/** Duplicate names are refused by a unique index on lower(btrim(name)). */
function duplicateContact(name: string): AccountingError {
  return new AccountingError("CONTACT_EXISTS", `There is already a contact called "${name}"`, 409);
}

function contactData(data: ContactCreateInput) {
  return {
    type: data.type,
    name: data.name.trim(),
    email: data.email?.trim() || null,
    phone: data.phone?.trim() || null,
    taxId: data.taxId?.trim() || null,
    billingAddress: normaliseAddress(data.billingAddress),
    shippingAddress: normaliseAddress(data.shippingAddress),
    paymentTermsDays: data.paymentTermsDays,
    notes: data.notes?.trim() || null,
  };
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const includeArchived = params.get("archived") === "true";
  const type = params.get("type");
  const query = params.get("q")?.trim();

  const contacts = await prisma.contact.findMany({
    where: {
      ...(includeArchived ? {} : { isArchived: false }),
      // A customer search must also find contacts that are both, so match the
      // role rather than the enum value.
      ...(type === "CUSTOMER" || type === "SUPPLIER" ? { type: { in: [type, "BOTH"] } } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: Prisma.QueryMode.insensitive } },
              { email: { contains: query, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(contacts);
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const validation = contactCreateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const data = contactData(validation.data);

  try {
    const contact = await prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({ data });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "contact.create",
        entityType: "Contact",
        entityId: created.id,
        after: auditableContact(created),
        ipAddress: guard.ctx.ipAddress,
      });
      return created;
    });
    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return booksError(duplicateContact(data.name));
    }
    return booksError(error);
  }
});
