export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { SETTINGS_NUMBER_CONTEXT, openNumber } from "@/lib/accounting/bank-numbers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { ledgerDateKey } from "@/lib/accounting/dates";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { BooksSettingsClient } from "./settings-client";

export default async function BooksSettingsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const settings = await prisma.companySettings.upsert({
    where: { id: COMPANY_SETTINGS_ID },
    update: {},
    create: { id: COMPANY_SETTINGS_ID },
  });

  return (
    <BooksSettingsClient
      settings={{
        legalName: settings.legalName,
        companyNumber: settings.companyNumber ?? "",
        vatNumber: settings.vatNumber ?? "",
        vatRegistered: settings.vatRegistered,
        yearStartMonth: settings.yearStartMonth,
        yearStartDay: settings.yearStartDay,
        lockDate: settings.lockDate ? ledgerDateKey(settings.lockDate) : "",
        registeredAddress: settings.registeredAddress ?? "",
        placeOfRegistration: settings.placeOfRegistration ?? "",
        bankAccountName: settings.bankAccountName ?? "",
        bankSortCode: settings.bankSortCode ?? "",
        // Decrypted for this screen only — the one place the full number is shown.
        bankAccountNumber: settings.bankAccountNumber
          ? openNumber(settings.bankAccountNumber, SETTINGS_NUMBER_CONTEXT)
          : "",
        invoicePrefix: settings.invoicePrefix,
        nextInvoiceNumber: settings.nextInvoiceNumber,
        invoiceNumberPad: settings.invoiceNumberPad,
        creditNotePrefix: settings.creditNotePrefix,
        nextCreditNoteNumber: settings.nextCreditNoteNumber,
        requireSecondApprover: settings.requireSecondApprover,
      }}
      canEdit={hasPermission(session, "books:settings")}
      canLock={hasPermission(session, "books:close")}
      canReopen={hasPermission(session, "books:reopen")}
    />
  );
}
