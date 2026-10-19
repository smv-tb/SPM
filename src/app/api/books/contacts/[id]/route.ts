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
import { contactUpdateSchema, type ContactUpdateInput } from "@/schemas/books";

type RouteContext = { params: Promise<{ id: string }> };

/** Only the fields the caller sent, trimmed; an address of spaces becomes null. */
function contactChanges(data: ContactUpdateInput): Prisma.ContactUpdateInput {
  const changes: Prisma.ContactUpdateInput = {};
  if (data.type !== undefined) changes.type = data.type;
  if (data.name !== undefined) changes.name = data.name.trim();
  if (data.email !== undefined) changes.email = data.email?.trim() || null;
  if (data.phone !== undefined) changes.phone = data.phone?.trim() || null;
  if (data.taxId !== undefined) changes.taxId = data.taxId?.trim() || null;
  if (data.billingAddress !== undefined) changes.billingAddress = normaliseAddress(data.billingAddress);
  if (data.shippingAddress !== undefined) changes.shippingAddress = normaliseAddress(data.shippingAddress);
  if (data.paymentTermsDays !== undefined) changes.paymentTermsDays = data.paymentTermsDays;
  if (data.notes !== undefined) changes.notes = data.notes?.trim() || null;
  if (data.isArchived !== undefined) changes.isArchived = data.isArchived;
  return changes;
}

export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  return NextResponse.json(contact);
});

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:post");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const validation = contactUpdateSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());
  const changes = contactChanges(validation.data);

  try {
    const contact = await prisma.$transaction(async (tx) => {
      const existing = await tx.contact.findUnique({ where: { id } });
      if (!existing) throw new AccountingError("NOT_FOUND", "Contact not found", 404);
      if (existing.anonymisedAt) {
        throw new AccountingError("ALREADY_ANONYMISED", "This contact has been anonymised and can no longer be edited", 409);
      }

      const updated = await tx.contact.update({ where: { id }, data: changes });
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "contact.update",
        entityType: "Contact",
        entityId: id,
        before: auditableContact(existing),
        after: auditableContact(updated),
        ipAddress: guard.ctx.ipAddress,
      });
      return updated;
    });
    return NextResponse.json(contact);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return booksError(
        new AccountingError("CONTACT_EXISTS", "There is already a contact with that name", 409)
      );
    }
    return booksError(error);
  }
});

/**
 * Deleting is for a contact created by mistake. Anything with history is
 * archived instead, which is why this needs the settings capability.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:settings");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.contact.findUnique({ where: { id } });
      if (!existing) throw new AccountingError("NOT_FOUND", "Contact not found", 404);

      await tx.contact.delete({ where: { id } });
      // Full snapshot: after this row is gone the audit log is the only record.
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "contact.delete",
        entityType: "Contact",
        entityId: id,
        before: auditableContact(existing),
        ipAddress: guard.ctx.ipAddress,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return booksError(
        new AccountingError(
          "CONTACT_IN_USE",
          "This contact has documents against it: archive it instead of deleting",
          409
        )
      );
    }
    return booksError(error);
  }
});
