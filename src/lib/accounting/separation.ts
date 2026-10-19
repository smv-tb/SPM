import type { Prisma } from "@prisma/client";
import { AccountingError } from "@/lib/accounting/errors";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";

/**
 * Separation of duties: the person who raised a document should not be the one
 * who approves it, and the person who posted a journal should not be the one who
 * reverses it — one set of eyes is how an honest mistake or a fraud goes through.
 *
 * It is a company setting (`CompanySettings.requireSecondApprover`), off by
 * default because a one-person company could never approve anything. When it is
 * off a self-approval still goes through but is marked `selfApproved` in the
 * audit log, so it can be reviewed afterwards.
 *
 * The decision is pure (`separationOutcome`) so it can be tested without a
 * database; the rest reads the setting and raises the refusal.
 */
export interface SeparationInput {
  /** `CompanySettings.requireSecondApprover` */
  required: boolean;
  /** The acting user, or null when the actor is not a person (the agent, a script). */
  actorUserId: string | null;
  /** Everyone who raised, created or posted the thing; null/undefined (a deleted user) are ignored. */
  involvedUserIds: ReadonlyArray<string | null | undefined>;
}

export type SeparationOutcome = { allowed: true; selfApproved: boolean } | { allowed: false };

export function separationOutcome({ required, actorUserId, involvedUserIds }: SeparationInput): SeparationOutcome {
  // Only a person can be "the same person". A non-person actor has no one to be the same as.
  const same = actorUserId !== null && involvedUserIds.some((id) => id === actorUserId);
  if (!same) return { allowed: true, selfApproved: false };
  return required ? { allowed: false } : { allowed: true, selfApproved: true };
}

/** Turning the setting off weakens a control, so that change needs a fresh second-factor check. */
export function separationDisabled(
  existing: { requireSecondApprover?: boolean | null } | null,
  incoming: { requireSecondApprover?: boolean | null }
): boolean {
  return existing?.requireSecondApprover === true && incoming.requireSecondApprover === false;
}

export const SEPARATION_CODE = "SEPARATION_OF_DUTIES";

export function separationError(thing: string, action: string): AccountingError {
  return new AccountingError(
    SEPARATION_CODE,
    `You ${thing === "journal" ? "created or posted" : "raised"} this ${thing}, so someone else has to ${action} it. ` +
      `(Company setting: a second person must approve.)`,
    403
  );
}

type Db = Pick<Prisma.TransactionClient, "companySettings">;

export async function loadSeparationRequired(db: Db): Promise<boolean> {
  const settings = await db.companySettings.findUnique({
    where: { id: COMPANY_SETTINGS_ID },
    select: { requireSecondApprover: true },
  });
  return settings?.requireSecondApprover === true;
}

/**
 * Applies the rule to one action: throws the refusal, or returns whether it was
 * a self-approval for the caller to record in the audit log.
 */
export async function enforceSeparation(
  db: Db,
  action: { thing: "invoice" | "credit note" | "journal"; verb: "approve" | "reverse" },
  actorUserId: string | null,
  involvedUserIds: ReadonlyArray<string | null | undefined>
): Promise<{ selfApproved: boolean }> {
  const outcome = separationOutcome({ required: await loadSeparationRequired(db), actorUserId, involvedUserIds });
  if (!outcome.allowed) throw separationError(action.thing, action.verb);
  return { selfApproved: outcome.selfApproved };
}
