export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { serializeBillRow } from "@/lib/accounting/serialize";
import { billSettlementInclude } from "@/lib/accounting/supplier-payments";
import { BILL_STATUSES, OPEN_BILL_STATUSES, type BillStatus } from "@/lib/accounting/bill";
import { calendarDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { BUSINESS_TIME_ZONE } from "@/lib/constants";
import { BillsClient } from "./bills-client";

const PAGE_SIZE = 50;

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string; supplier?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const params = await searchParams;
  // "overdue" is a fact about an unpaid bill, not a stored status.
  const overdueOnly = params.status === "overdue";
  const status = BILL_STATUSES.includes(params.status as BillStatus) ? (params.status as BillStatus) : null;
  const q = (params.q ?? "").trim().slice(0, 100);
  const supplier = (params.supplier ?? "").trim().slice(0, 200);
  const today = toLedgerDate(calendarDateKey(new Date(), BUSINESS_TIME_ZONE));
  const open = { in: [...OPEN_BILL_STATUSES] };

  // Filters other than status, so the chip counts say what each chip would show.
  const base: Prisma.BillWhereInput = {
    ...(supplier ? { supplierName: supplier } : {}),
    ...(q
      ? {
          OR: [
            { supplierReference: { contains: q, mode: "insensitive" } },
            { supplierName: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const where: Prisma.BillWhereInput = overdueOnly
    ? { ...base, status: open, dueDate: { lt: today } }
    : status
      ? { ...base, status }
      : base;

  const [total, counts, overdueCount, suppliers, openBills] = await Promise.all([
    prisma.bill.count({ where }),
    prisma.bill.groupBy({ by: ["status"], where: base, _count: true }),
    prisma.bill.count({ where: { ...base, status: open, dueDate: { lt: today } } }),
    prisma.bill.findMany({ distinct: ["supplierName"], select: { supplierName: true }, orderBy: { supplierName: "asc" } }),
    prisma.bill.findMany({ where: { ...base, status: open }, include: billSettlementInclude }),
  ]);

  // A stale page number (a filter narrowed the list) clamps rather than 404s.
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(params.page ?? "1", 10) || 1), pages);

  const bills = await prisma.bill.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { _count: { select: { attachments: true } }, ...billSettlementInclude },
  });

  const todayKey = calendarDateKey(new Date(), BUSINESS_TIME_ZONE);
  const owedRows = openBills.map(serializeBillRow);
  const owed = owedRows.reduce((sum, r) => sum + r.amountDue, 0);
  const owedOverdue = owedRows.filter((r) => r.dueDate < todayKey).reduce((sum, r) => sum + r.amountDue, 0);

  const countByStatus: Record<string, number> = {};
  for (const c of counts) countByStatus[c.status] = c._count;

  return (
    <BillsClient
      bills={bills.map(serializeBillRow)}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      status={overdueOnly ? "overdue" : status}
      query={q}
      supplier={supplier}
      suppliers={suppliers.map((s) => s.supplierName).filter(Boolean)}
      counts={{ ...countByStatus, all: Object.values(countByStatus).reduce((a, b) => a + b, 0), overdue: overdueCount }}
      owed={owed}
      owedOverdue={owedOverdue}
      canEdit={hasPermission(session, "books:post")}
    />
  );
}
