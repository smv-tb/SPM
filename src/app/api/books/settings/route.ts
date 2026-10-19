export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandler } from "@/lib/api-errors";
import { booksError, invalidRequest, requireBooks } from "@/lib/books-api";
import { recordAudit } from "@/lib/audit";
import { calendarDateKey, financialYearContaining, ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { companySettingsSchema } from "@/schemas/books";
import { bankDetailsChanged, markBankDetailsChanged } from "@/lib/accounting/bank-details-change";
import { actorLabel, alertInBackground } from "@/lib/security-alerts";
import {
  SETTINGS_NUMBER_CONTEXT, auditableSettings, maskNumber, openNumber, sealNumber,
} from "@/lib/accounting/bank-numbers";
import { separationDisabled } from "@/lib/accounting/separation";
import { stepUpGuard } from "@/lib/mfa/step-up";

function serialize(settings: {
  id: string;
  legalName: string;
  companyNumber: string | null;
  vatNumber: string | null;
  vatRegistered: boolean;
  baseCurrency: string;
  yearStartMonth: number;
  yearStartDay: number;
  lockDate: Date | null;
  nextJournalNumber: number;
  bankAccountNumber: string | null;
}) {
  const year = financialYearContaining(
    toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE)),
    settings.yearStartMonth,
    settings.yearStartDay
  );
  return {
    ...settings,
    // The full number is only ever shown on the settings screen itself (server-rendered).
    bankAccountNumber: maskNumber(
      settings.bankAccountNumber ? openNumber(settings.bankAccountNumber, SETTINGS_NUMBER_CONTEXT) : null
    ),
    lockDate: settings.lockDate ? ledgerDateKey(settings.lockDate) : null,
    currentFinancialYear: { start: ledgerDateKey(year.start), end: ledgerDateKey(year.end) },
  };
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:view");
  if (!guard.ok) return guard.response;

  // The row is seeded by the ledger migration; upsert keeps a fresh or
  // partially-restored database usable rather than 500ing.
  const settings = await prisma.companySettings.upsert({
    where: { id: COMPANY_SETTINGS_ID },
    update: {},
    create: { id: COMPANY_SETTINGS_ID },
  });
  return NextResponse.json(serialize(settings));
});

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const guard = await requireBooks(req, "books:settings");
  if (!guard.ok) return guard.response;

  const validation = companySettingsSchema.safeParse(await req.json());
  if (!validation.success) return invalidRequest(validation.error.flatten());

  // The bank details on every invoice, and the second-approver control: changing the first or
  // switching the second *off* needs a fresh second-factor check.
  const before = await prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });
  // A masked value ("••••1234") is what responses show; saving it back would destroy the real number.
  if (validation.data.bankAccountNumber?.includes("•")) {
    return invalidRequest({ formErrors: [], fieldErrors: { bankAccountNumber: ["Enter the full account number"] } });
  }
  const beforePlain = before && {
    ...before,
    bankAccountNumber: before.bankAccountNumber
      ? openNumber(before.bankAccountNumber, SETTINGS_NUMBER_CONTEXT)
      : null,
  };
  const payeeChanged = bankDetailsChanged(beforePlain, validation.data);
  if (payeeChanged || separationDisabled(before, validation.data)) {
    const refusal = await stepUpGuard(guard.ctx.session);
    if (refusal) return refusal;
  }

  try {
    // The account number is sealed before it reaches the database.
    const stored = { ...validation.data };
    if (validation.data.bankAccountNumber !== undefined) {
      const plain = validation.data.bankAccountNumber?.trim();
      stored.bankAccountNumber = plain ? sealNumber(plain, SETTINGS_NUMBER_CONTEXT) : null;
    }
    const settings = await prisma.$transaction(async (tx) => {
      const existing = await tx.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });
      const updated = await tx.companySettings.upsert({
        where: { id: COMPANY_SETTINGS_ID },
        update: stored,
        create: { id: COMPANY_SETTINGS_ID, ...stored },
      });
      if (payeeChanged) await markBankDetailsChanged(tx, actorLabel(guard.ctx.actor));
      await recordAudit(tx, {
        actor: guard.ctx.actor,
        action: "books.settings",
        entityType: "CompanySettings",
        entityId: COMPANY_SETTINGS_ID,
        before: auditableSettings(existing),
        after: auditableSettings(updated),
        ipAddress: guard.ctx.ipAddress,
      });
      return updated;
    });
    if (payeeChanged) {
      alertInBackground({
        event: "bank.details_changed",
        summary: "The bank details printed on invoices were changed",
        actor: actorLabel(guard.ctx.actor),
        ipAddress: guard.ctx.ipAddress,
      });
    }
    return NextResponse.json(serialize(settings));
  } catch (error) {
    return booksError(error);
  }
});
