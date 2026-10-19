export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeCreditNoteRow } from "@/lib/accounting/serialize";
import { CREDIT_NOTE_STATUSES, type CreditNoteStatus } from "@/lib/accounting/credit-note";
import { CreditNotesClient } from "./credit-notes-client";

const PAGE_SIZE = 50;

export default async function CreditNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const params = await searchParams;
  const status = CREDIT_NOTE_STATUSES.includes(params.status as CreditNoteStatus)
    ? (params.status as CreditNoteStatus)
    : null;
  const where = status ? { status } : {};

  const total = await prisma.creditNote.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(params.page ?? "1", 10) || 1), pages);

  const notes = await prisma.creditNote.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      invoice: { select: { id: true, number: true } },
      allocations: { where: { releasedOn: null }, select: { amount: true } },
    },
  });

  return (
    <CreditNotesClient
      creditNotes={notes.map(serializeCreditNoteRow)}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      status={status}
      canEdit={hasPermission(session, "books:post")}
    />
  );
}
