export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { requireBooks } from "@/lib/books-api";
import { loadContactRetention } from "@/lib/accounting/contact-privacy";

type RouteContext = { params: Promise<{ id: string }> };

/** Whether this contact's personal details can be removed yet, and if not, why and until when. */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const guard = await requireBooks(req, "books:privacy");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const retention = await loadContactRetention(prisma, id);
  if (!retention) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  return NextResponse.json(retention);
});
