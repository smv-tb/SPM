export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeInvoiceRow } from "@/lib/accounting/serialize";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/accounting/invoice";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { InvoicesClient } from "./invoices-client";
import { settlementInclude } from "@/lib/accounting/settlement";

const PAGE_SIZE = 50;
const OPEN: InvoiceStatus[] = ["APPROVED", "SENT", "PART_PAID"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string; customer?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const params = await searchParams;
  // "overdue" is a fact about an unpaid invoice, not a stored status.
  const overdueOnly = params.status === "overdue";
  const status = INVOICE_STATUSES.includes(params.status as InvoiceStatus)
    ? (params.status as InvoiceStatus)
    : null;
  const q = (params.q ?? "").trim().slice(0, 100);
  const customer = (params.customer ?? "").trim().slice(0, 200);
  const today = toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE));

  // Filters other than status, so the chip counts say what each chip would show.
  const base: Prisma.InvoiceWhereInput = {
    ...(customer ? { billToName: customer } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { billToName: { contains: q, mode: "insensitive" } },
            { reference: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const where: Prisma.InvoiceWhereInput = overdueOnly
    ? { ...base, status: { in: OPEN }, dueDate: { lt: today } }
    : status
      ? { ...base, status }
      : base;

  const [total, counts, overdueCount, customers, openInvoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({ by: ["status"], where: base, _count: true }),
    prisma.invoice.count({ where: { ...base, status: { in: OPEN }, dueDate: { lt: today } } }),
    prisma.invoice.findMany({ distinct: ["billToName"], select: { billToName: true }, orderBy: { billToName: "asc" } }),
    prisma.invoice.findMany({ where: { ...base, status: { in: OPEN } }, include: settlementInclude }),
  ]);

  // A stale page number (a filter narrowed the list) clamps rather than 404s.
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(params.page ?? "1", 10) || 1), pages);

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: settlementInclude,
  });

  const todayKey = calendarDateKey(new Date(), BUSINESS_TIME_ZONE);
  const owedRows = openInvoices.map(serializeInvoiceRow);
  const owed = owedRows.reduce((sum, r) => sum + r.amountDue, 0);
  const owedOverdue = owedRows
    .filter((r) => r.dueDate < todayKey)
    .reduce((sum, r) => sum + r.amountDue, 0);

  const countByStatus: Record<string, number> = {};
  for (const c of counts) countByStatus[c.status] = c._count;

  return (
    <InvoicesClient
      invoices={invoices.map(serializeInvoiceRow)}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      status={overdueOnly ? "overdue" : status}
      query={q}
      customer={customer}
      customers={customers.map((c) => c.billToName).filter(Boolean)}
      counts={{ ...countByStatus, all: Object.values(countByStatus).reduce((a, b) => a + b, 0), overdue: overdueCount }}
      owed={owed}
      owedOverdue={owedOverdue}
      canEdit={hasPermission(session, "books:post")}
    />
  );
}
