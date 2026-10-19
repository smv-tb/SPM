export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { ContactsClient, type ContactRow } from "./contacts-client";

export default async function ContactsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const contacts = await prisma.contact.findMany({ orderBy: { name: "asc" } });

  const rows: ContactRow[] = contacts.map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    email: c.email,
    phone: c.phone,
    taxId: c.taxId,
    billingAddress: c.billingAddress,
    shippingAddress: c.shippingAddress,
    paymentTermsDays: c.paymentTermsDays,
    notes: c.notes,
    isArchived: c.isArchived,
    anonymisedAt: c.anonymisedAt ? c.anonymisedAt.toISOString() : null,
  }));

  return (
    <ContactsClient
      contacts={rows}
      canEdit={hasPermission(session, "books:post")}
      canDelete={hasPermission(session, "books:settings")}
      canPrivacy={hasPermission(session, "books:privacy")}
    />
  );
}
