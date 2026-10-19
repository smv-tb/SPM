import type { Prisma } from "@prisma/client";

/**
 * Project lifecycle: create (optionally from a template), archive, restore,
 * delete. Everything takes the caller's transaction so the change and its
 * audit row commit together.
 *
 * Archive is the normal way to retire a project: the data stays and a database
 * trigger makes it read-only. Delete is for a project created by mistake and
 * is refused once the project has ever held money, because `Project` cascades
 * to funding records and cash transactions.
 */

type Tx = Prisma.TransactionClient;

export interface NewProject {
  name: string;
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  logoUrl?: string | null;
}

/** What a template copies: structure only, never tasks, people or money. */
export interface TemplateCopy {
  phases: number;
  tags: number;
  customFields: number;
}

export async function createProject(
  tx: Tx,
  data: NewProject,
  createdBy: string,
  templateProjectId?: string | null
): Promise<{ project: Prisma.ProjectGetPayload<object>; copied: TemplateCopy | null }> {
  const project = await tx.project.create({ data: { ...data, createdBy } });
  // Whoever starts a project can open it (S2.7). Admins reach every project without a row.
  const creator = await tx.user.findUnique({ where: { id: createdBy }, select: { role: true } });
  if (creator && creator.role !== "ADMIN") {
    await tx.projectMember.create({ data: { projectId: project.id, userId: createdBy, role: creator.role, addedById: createdBy } });
  }
  if (!templateProjectId) return { project, copied: null };

  const [phases, tags, fields] = await Promise.all([
    tx.phase.findMany({ where: { projectId: templateProjectId }, orderBy: { orderIndex: "asc" } }),
    tx.tag.findMany({ where: { projectId: templateProjectId } }),
    tx.customFieldDefinition.findMany({ where: { projectId: templateProjectId } }),
  ]);
  // Dates belong to the old project's timeline, so phases come across without them.
  if (phases.length) {
    await tx.phase.createMany({
      data: phases.map((p) => ({ projectId: project.id, name: p.name, orderIndex: p.orderIndex, color: p.color })),
    });
  }
  if (tags.length) {
    await tx.tag.createMany({ data: tags.map((t) => ({ projectId: project.id, name: t.name, color: t.color })) });
  }
  if (fields.length) {
    await tx.customFieldDefinition.createMany({
      data: fields.map((f) => ({
        projectId: project.id,
        module: f.module,
        name: f.name,
        fieldType: f.fieldType,
        options: f.options ?? undefined,
        required: f.required,
        defaultValue: f.defaultValue,
        orderIndex: f.orderIndex,
      })),
    });
  }
  return { project, copied: { phases: phases.length, tags: tags.length, customFields: fields.length } };
}

export interface DeletionBlockers {
  fundingRecords: number;
  cashTransactions: number;
  tasksWithSpend: number;
  livingLabCostsWithSpend: number;
  /** Posted journals and invoices tagged with this project; the books keep the id. */
  bookEntries: number;
}

/** Reasons a project may not be deleted; all zero means it never held money. */
export async function deletionBlockers(tx: Tx, projectId: string): Promise<DeletionBlockers> {
  const [fundingRecords, cashTransactions, tasksWithSpend, livingLabCostsWithSpend, journalLines, invoices] =
    await Promise.all([
      tx.fundingRecord.count({ where: { projectId } }),
      tx.cashTransaction.count({ where: { projectId } }),
      tx.task.count({ where: { projectId, OR: [{ actualSpend: { gt: 0 } }, { extCosts: { gt: 0 } }] } }),
      tx.livingLabCost.count({ where: { lab: { projectId }, actualSpend: { gt: 0 } } }),
      tx.journalLine.count({ where: { projectId } }),
      tx.invoice.count({ where: { projectId } }),
    ]);
  return {
    fundingRecords,
    cashTransactions,
    tasksWithSpend,
    livingLabCostsWithSpend,
    bookEntries: journalLines + invoices,
  };
}

export function canDelete(blockers: DeletionBlockers): boolean {
  return Object.values(blockers).every((n) => n === 0);
}

/** Audit snapshot: the project row and how much went with it. */
export async function projectSnapshot(tx: Tx, projectId: string) {
  return tx.project.findUnique({
    where: { id: projectId },
    include: {
      _count: { select: { phases: true, milestones: true, tasks: true, resources: true, livingLabs: true, tags: true, customFieldDefinitions: true } },
    },
  });
}
