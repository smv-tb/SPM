export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, requireBooks } from "@/lib/books-api";
import { recordAudit } from "@/lib/audit";
import { exportContactData } from "@/lib/accounting/contact-privacy";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Subject access: everything held about one contact, as a JSON download. The
 * export itself is audited (who took a copy of someone's data, and when); the
 * audit row holds no personal data.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:privacy");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const data = await prisma.$transaction(async (tx) => {
      const exported = await exportContactData(tx, id);
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "contact.export",
        entityType: "Contact",
        entityId: id,
        after: { invoices: Array.isArray(exported.invoices) ? exported.invoices.length : 0 },
        ipAddress: guard.ctx.ipAddress,
      });
      return exported;
    });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="contact-${id}-export.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return booksError(error);
  }
});
