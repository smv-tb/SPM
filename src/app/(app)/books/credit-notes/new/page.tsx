export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeInvoice } from "@/lib/accounting/serialize";
import { creditNoteFormOptions } from "../form-options";
import { NewCreditNoteClient } from "./new-credit-note-client";
import { settlementInclude } from "@/lib/accounting/settlement";

/**
 * `?invoice=<id>` raises the credit note against that invoice, starting from
 * a copy of its lines — crediting in full is then one click, and a partial
 * credit is a matter of trimming quantities.
 */
export default async function NewCreditNotePage({
  searchParams,
}: {
  searchParams: Promise<{ invoice?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:post")) redirect("/books");

  const { invoice: invoiceId } = await searchParams;
  const invoice = invoiceId
    ? await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          ...settlementInclude,
        },
      })
    : null;
  // Only an approved, unvoided invoice can be credited; anything else is a
  // stale link, so fall back to a standalone credit note.
  const creditable = invoice && invoice.status !== "DRAFT" && invoice.status !== "VOID";
  const serialized = creditable ? serializeInvoice(invoice) : null;

  const { customers, products } = await creditNoteFormOptions(serialized?.contactId);

  return (
    <NewCreditNoteClient
      customers={customers}
      products={products}
      creditFor={
        serialized
          ? {
              id: serialized.id,
              number: serialized.number,
              contactId: serialized.contactId,
              amountDue: serialized.amountDue,
            }
          : null
      }
      initialLines={serialized?.lines}
      canApprove={hasPermission(session, "books:approve")}
    />
  );
}
