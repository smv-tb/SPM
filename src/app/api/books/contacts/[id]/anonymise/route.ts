export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { anonymiseContact } from "@/lib/accounting/contact-privacy";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().trim().min(1, "Say why").max(300) });

/**
 * Removes a contact's personal details once its retention period has passed.
 * Irreversible, so it needs a second-factor check; the database refuses it
 * inside the retention window whatever this route does.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:privacy", { stepUp: true });
  if (!guard.ok) return guard.response;

  const validation = bodySchema.safeParse(await req.json().catch(() => null));
  if (!validation.success) return invalidRequest(validation.error.flatten());

  const { id } = await params;
  try {
    await prisma.$transaction((tx) =>
      anonymiseContact(tx, { contactId: id, reason: validation.data.reason, actor: guard.ctx.actor, ipAddress: guard.ctx.ipAddress })
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return booksError(error);
  }
});
