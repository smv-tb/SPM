export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toPence } from "@/lib/money";
import { Topbar } from "@/components/layout/topbar";
import { calendarDateKey, financialYearContaining, ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { buildTrialBalance } from "@/lib/accounting/trial-balance";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { AlertTriangle, BookOpen, FileSpreadsheet, Hourglass, Scale, TrendingUp } from "lucide-react";
import { settlementInclude } from "@/lib/accounting/settlement";

export default async function BooksPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const [settings, drafts, posted, accounts, movements, openInvoices, credits, draftInvoices, draftCreditNotes, unreconciledLines] =
    await Promise.all([
    prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } }),
    prisma.journalEntry.count({ where: { status: "DRAFT" } }),
    prisma.journalEntry.count({ where: { status: "POSTED" } }),
    prisma.ledgerAccount.findMany({
      where: { isArchived: false },
      select: { id: true, code: true, name: true, type: true },
    }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    }),
    prisma.invoice.findMany({
      where: { status: { in: ["APPROVED", "SENT", "PART_PAID"] } },
      select: { total: true, dueDate: true, ...settlementInclude },
    }),
    prisma.creditNote.findMany({
      where: { status: "APPROVED" },
      select: { total: true, allocations: { where: { releasedOn: null }, select: { amount: true } } },
    }),
    prisma.invoice.count({ where: { status: "DRAFT" } }),
    prisma.creditNote.count({ where: { status: "DRAFT" } }),
    prisma.statementLine.count({ where: { reconciledAt: null } }),
  ]);

  const trialBalance = buildTrialBalance(
    accounts,
    movements.map((m) => ({
      accountId: m.accountId,
      debit: toPence(m._sum.debit ?? 0),
      credit: toPence(m._sum.credit ?? 0),
    }))
  );

  const year = settings
    ? financialYearContaining(
        toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE)),
        settings.yearStartMonth,
        settings.yearStartDay
      )
    : null;

  // What customers owe after credit notes, and how much of it is late.
  const allocated = (rows: { amount: Prisma.Decimal }[]) =>
    rows.reduce((sum, row) => sum + toPence(row.amount), 0);
  const owed = openInvoices.reduce(
    (sum, invoice) =>
      sum +
      toPence(invoice.total) -
      allocated(invoice.creditAllocations) -
      allocated(invoice.paymentAllocations),
    0
  );
  const unusedCredit = credits.reduce(
    (sum, note) => sum + toPence(note.total) - allocated(note.allocations),
    0
  );
  const todayKey = calendarDateKey(new Date(), BUSINESS_TIME_ZONE);
  const overdueInvoices = openInvoices.filter((i) => ledgerDateKey(i.dueDate) < todayKey);
  const overdue = overdueInvoices.length;
  const overduePence = overdueInvoices.reduce(
    (sum, invoice) =>
      sum +
      toPence(invoice.total) -
      allocated(invoice.creditAllocations) -
      allocated(invoice.paymentAllocations),
    0
  );
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // Most urgent first; an item with nothing to do shows as clear rather than disappearing.
  const attention: { key: string; count: number; title: string; detail: string; href: string; action: string }[] = [
    {
      key: "overdue",
      count: overdue,
      title: overdue > 0 ? `${plural(overdue, "overdue invoice")} to chase` : "No overdue invoices",
      detail: overdue > 0 ? `${formatPence(overduePence)} past its due date, of ${formatPence(owed)} owed in total` : `${formatPence(owed)} owed, none late`,
      href: "/books/aged-debtors",
      action: "Open aged debtors",
    },
    {
      key: "drafts",
      count: draftInvoices + draftCreditNotes,
      title: draftInvoices + draftCreditNotes > 0 ? `${plural(draftInvoices, "draft invoice")} and ${plural(draftCreditNotes, "draft credit note")} waiting for approval` : "No invoices or credit notes waiting for approval",
      detail: "Nothing posts to the ledger until it is approved",
      href: "/books/invoices",
      action: "Review drafts",
    },
    {
      key: "bank",
      count: unreconciledLines,
      title: unreconciledLines > 0 ? `${plural(unreconciledLines, "bank line")} not yet reconciled` : "Every imported bank line is reconciled",
      detail: "Match statement lines to invoices, payments or journals",
      href: "/books/bank",
      action: "Reconcile",
    },
    {
      key: "journals",
      count: drafts,
      title: drafts > 0 ? `${plural(drafts, "draft journal")} not yet posted` : "No draft journals",
      detail: "Drafts can be edited; posted journals can only be reversed",
      href: "/books/journals",
      action: "Open journals",
    },
    {
      key: "credit",
      count: unusedCredit > 0 ? credits.length : 0,
      title: unusedCredit > 0 ? `${formatPence(unusedCredit)} of credit not yet allocated` : "All credit is allocated",
      detail: "Apply credit notes to invoices they relate to",
      href: "/books/credit-notes",
      action: "Open credit notes",
    },
  ];

  const reports = [
    { href: "/books/aged-debtors", icon: Hourglass, label: "Aged debtors", detail: `${formatPence(owed)} owed` },
    { href: "/books/trial-balance", icon: Scale, label: "Trial balance", detail: trialBalance.balanced ? "Balanced" : "Out of balance" },
    { href: "/books/profit-and-loss", icon: TrendingUp, label: "Profit and loss", detail: "Any period, with comparative" },
    { href: "/books/balance-sheet", icon: FileSpreadsheet, label: "Balance sheet", detail: "As at any date" },
    { href: "/books/accounts", icon: BookOpen, label: "Chart of accounts", detail: plural(accounts.length, "account") },
  ];

  return (
    <>
      <Topbar
        title="Accounting overview"
        subtitle={settings?.legalName || "Company accounts"}
        breadcrumbs={[{ label: "Accounting", href: "/books" }, { label: "Overview" }]}
      />

      <main id="books-main" className="flex-1 overflow-auto p-4 lg:p-8 space-y-8 max-w-5xl">
        {/* Ledger integrity: the first thing to know is whether the books add up. */}
        <section
          aria-label="Ledger integrity"
          className={`rounded-[28px] p-6 ${trialBalance.balanced ? "bg-ledger-tint" : "bg-destructive/10"}`}
        >
          <div className="flex items-start gap-3">
            {trialBalance.balanced ? (
              <Scale className="w-6 h-6 text-ledger shrink-0 mt-1" aria-hidden />
            ) : (
              <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-1" aria-hidden />
            )}
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {trialBalance.balanced
                  ? `Trial balance: balanced at ${formatPence(trialBalance.totalDebit)}`
                  : "Trial balance: does not balance. Investigate before posting more."}
              </h2>
              <p className="mt-1 text-base text-foreground">
                {plural(posted, "posted journal")}
                {settings?.lockDate ? (
                  <>
                    . Locked up to and including <strong>{formatDate(ledgerDateKey(settings.lockDate))}</strong>.
                  </>
                ) : (
                  ". No lock date set, so any date can still be posted to."
                )}
                {year && <> Financial year {formatDate(ledgerDateKey(year.start))} to {formatDate(ledgerDateKey(year.end))}.</>}
              </p>
              <p className="mt-2 flex flex-wrap gap-x-4 text-sm font-semibold">
                <Link href="/books/trial-balance" className="text-ledger underline underline-offset-2">View trial balance</Link>
                {hasPermission(session, "books:settings") && (
                  <Link href="/books/settings" className="text-ledger underline underline-offset-2">Company settings and lock date</Link>
                )}
              </p>
            </div>
          </div>
        </section>

        {/* What needs attention, most urgent first. A ruled list, not a grid of tiles. */}
        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="text-xl font-bold text-foreground mb-2">Needs attention today</h2>
          <ul className="divide-y divide-border border-y border-border">
            {attention.map((item) => {
              const clear = item.count === 0;
              return (
                <li key={item.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset min-w-[5.5rem] justify-center ${
                      clear ? "bg-primary/10 text-primary ring-input" : "bg-warning/10 text-warning ring-input"
                    }`}
                  >
                    <span aria-hidden>{clear ? "✓" : "▲"}</span>
                    {clear ? "Clear" : "To do"}
                  </span>
                  <div className="flex-1 min-w-[16rem]">
                    <p className="text-base font-semibold text-foreground">{item.title}</p>
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                  <Link
                    href={item.href}
                    className="inline-flex items-center min-h-11 md:min-h-9 px-4 rounded-full border border-input text-sm font-semibold text-ledger hover:bg-ledger/10"
                  >
                    {item.action}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="reports-heading">
          <h2 id="reports-heading" className="text-xl font-bold text-foreground mb-2">Reports</h2>
          <ul className="grid sm:grid-cols-2 gap-x-8 divide-y sm:divide-y-0 divide-border">
            {reports.map((r) => (
              <li key={r.href} className="sm:border-b sm:border-border">
                <Link href={r.href} className="flex items-center gap-3 py-3 min-h-11 hover:text-ledger">
                  <r.icon className="w-5 h-5 text-ledger shrink-0" aria-hidden />
                  <span className="font-semibold">{r.label}</span>
                  <span className="ml-auto text-sm text-muted-foreground">{r.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
