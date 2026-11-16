import type { FundingTranche, Prisma } from "@prisma/client";

/** Statuses a tranche can be received from. RECEIVED is final. */
export const RECEIVABLE_STATUSES = ["PENDING", "DELAYED"] as const;

export type ReceiveTrancheResult =
  | { kind: "not_found" }
  | { kind: "already_received"; existing: FundingTranche }
  | { kind: "received"; before: FundingTranche; after: FundingTranche };

/** The refusal both the web route and Hermes return, shaped like the books' `{ error, code }`. */
export const ALREADY_RECEIVED = {
  error: "Tranche is already received — its receipt date cannot be changed here",
  code: "ALREADY_RECEIVED",
} as const;

/**
 * Marks a tranche received, once. The status check and the write are one
 * conditional UPDATE, so two concurrent receipts cannot both pass: the second
 * waits on the row lock, re-reads the row as RECEIVED and matches nothing.
 * Without this a repeat call silently moved the receipt date.
 */
export async function receiveTranche(
  tx: Prisma.TransactionClient,
  id: string,
  receivedDate: Date
): Promise<ReceiveTrancheResult> {
  const before = await tx.fundingTranche.findUnique({ where: { id } });
  if (!before) return { kind: "not_found" };

  const { count } = await tx.fundingTranche.updateMany({
    where: { id, status: { in: [...RECEIVABLE_STATUSES] } },
    data: { status: "RECEIVED", receivedDate },
  });
  if (count === 0) {
    const existing = await tx.fundingTranche.findUnique({ where: { id } });
    return existing ? { kind: "already_received", existing } : { kind: "not_found" };
  }

  const after = await tx.fundingTranche.findUniqueOrThrow({ where: { id } });
  return { kind: "received", before, after };
}
