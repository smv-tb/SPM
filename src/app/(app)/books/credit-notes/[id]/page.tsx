export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { creditNoteDetail } from "@/lib/accounting/credit-notes";
import { serializeCreditNote, serializeInvoiceRow } from "@/lib/accounting/serialize";
import { creditNoteFormOptions } from "../form-options";
import { bankAccountOptions } from "@/lib/accounting/bank-accounts";
import { CreditNoteDetailClient } from "./credit-note-detail-client";
import { settlementInclude } from "@/lib/accounting/settlement";

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const note = await prisma.creditNote.findUnique({ where: { id }, include: creditNoteDetail });
  if (!note) notFound();
  const serialized = serializeCreditNote(note);

  // Pickers only for a draft; open invoices only while there is credit to use.
  const options =
    note.status === "DRAFT"
      ? await creditNoteFormOptions(note.contactId)
      : { customers: [], products: [] };
  const openInvoices =
    serialized.remaining > 0
      ? (
          await prisma.invoice.findMany({
            where: {
              contactId: note.contactId,
              status: { in: ["APPROVED", "SENT", "PART_PAID"] },
            },
            orderBy: { issueDate: "asc" },
            include: settlementInclude,
          })
        )
          .map(serializeInvoiceRow)
          .filter((invoice) => invoice.amountDue > 0)
      : [];

  const bankAccounts = serialized.remaining > 0 ? await bankAccountOptions() : [];

  return (
    <CreditNoteDetailClient
      bankAccounts={bankAccounts}
      creditNote={serialized}
      customers={options.customers}
      products={options.products}
      openInvoices={openInvoices.map((i) => ({ id: i.id, number: i.number, amountDue: i.amountDue }))}
      canEdit={hasPermission(session, "books:post")}
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
