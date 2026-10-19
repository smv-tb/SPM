import { Prisma } from "@prisma/client";
import { toPence, type Pence } from "@/lib/money";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { settledStatus } from "./credit-note";
import type { InvoiceStatus } from "./invoice";

/**
 * How invoices are settled: by credit notes (CreditAllocation) and receipts
 * (PaymentAllocation) together. One place, so the credit-note and payment
 * services cannot disagree about what an invoice still owes — the database
 * guards use the same sum (`invoice_settled`).
 */

type Tx = Prisma.TransactionClient;
/** A transaction or the plain client: these reads change nothing. */
type Reader = Pick<Tx, "creditAllocation" | "paymentAllocation">;

/** What every invoice query needs to report credited, paid and due. */
export const settlementInclude = {
  creditAllocations: { where: { releasedOn: null }, select: { amount: true } },
  paymentAllocations: { where: { releasedOn: null }, select: { amount: true } },
} satisfies Prisma.InvoiceInclude;

/** Allocations that still count: a void releases them rather than deleting them. */
export const live = { releasedOn: null } as const;

function byKey<T extends string>(rows: { key: T | null; amount: Prisma.Decimal | null }[]) {
  const map = new Map<string, Pence>();
  for (const row of rows) {
    if (row.key === null) continue;
    map.set(row.key, (map.get(row.key) ?? 0) + (row.amount ? toPence(row.amount) : 0));
  }
  return map;
}

/** Pence applied to each invoice, credits and payments together. */
export async function settledByInvoice(
  tx: Reader,
  invoiceIds: string[]
): Promise<{ credited: Map<string, Pence>; paid: Map<string, Pence>; settled: Map<string, Pence> }> {
  if (invoiceIds.length === 0) {
    return { credited: new Map(), paid: new Map(), settled: new Map() };
  }
  const [credits, payments] = await Promise.all([
    tx.creditAllocation.groupBy({
      by: ["invoiceId"],
      where: { invoiceId: { in: invoiceIds }, ...live },
      _sum: { amount: true },
    }),
    tx.paymentAllocation.groupBy({
      by: ["invoiceId"],
      where: { invoiceId: { in: invoiceIds }, ...live },
      _sum: { amount: true },
    }),
  ]);
  const credited = byKey(credits.map((r) => ({ key: r.invoiceId, amount: r._sum.amount })));
  const paid = byKey(payments.map((r) => ({ key: r.invoiceId, amount: r._sum.amount })));
  const settled = new Map<string, Pence>();
  for (const id of invoiceIds) settled.set(id, (credited.get(id) ?? 0) + (paid.get(id) ?? 0));
  return { credited, paid, settled };
}

/** Moves an invoice to the status its settlement implies, audited when it changes. */
export async function refreshInvoiceStatus(tx: Tx, invoiceId: string, actor: AuditActor): Promise<void> {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return;
  const settled = (await settledByInvoice(tx, [invoiceId])).settled.get(invoiceId) ?? 0;
  const status = settledStatus(
    invoice.status as InvoiceStatus,
    toPence(invoice.total),
    settled,
    invoice.sentAt
  );
  if (status === invoice.status) return;

  const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  await recordAudit(tx, {
    actor,
    action: "invoice.settle",
    entityType: "Invoice",
    entityId: invoiceId,
    before: { status: invoice.status },
    after: { status: updated.status },
  });
}

/**
 * Releases the live allocations matching one column, dated on the business
 * day of the void (never before the allocation's own date). They stay on
 * record, so a report as at an earlier date still sees them.
 */
export async function releaseAllocations(
  tx: Tx,
  table: "credit_allocations" | "payment_allocations",
  column: "creditNoteId" | "paymentId" | "refundId",
  id: string,
  on: Date
): Promise<void> {
  // Table and column come from the unions above, never from input.
  await tx.$executeRawUnsafe(
    `UPDATE "${table}" SET "releasedOn" = GREATEST($1::date, "date")
      WHERE "${column}" = $2 AND "releasedOn" IS NULL`,
    on,
    id
  );
}

/** Locks an invoice row: the first lock every allocation takes. */
export async function lockInvoice(tx: Tx, invoiceId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
}
