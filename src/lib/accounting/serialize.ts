import { toPence, type Pence } from "@/lib/money";
import { bankAccountNumberContext, maskedNumberOrUnreadable } from "./bank-numbers";
import { ledgerDateKey } from "./dates";

/**
 * Wire format for the books API.
 *
 * Amounts go out as integer pence, not pounds: the browser cannot represent
 * 0.1 + 0.2 exactly either, and every books screen formats through
 * `formatPence`. Ledger dates go out as "YYYY-MM-DD" — they are calendar days,
 * and an ISO timestamp would invite a timezone to shift them.
 */

type Money = { toFixed(): string } | string | number;

export interface SerializedLine {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  description: string | null;
  debit: Pence;
  credit: Pence;
  projectId: string | null;
  phaseId: string | null;
  milestoneId: string | null;
}

interface LineRow {
  id: string;
  lineNumber: number;
  accountId: string;
  description: string | null;
  debit: Money;
  credit: Money;
  projectId: string | null;
  phaseId: string | null;
  milestoneId: string | null;
  account?: { code: string; name: string } | null;
}

export function serializeLine(line: LineRow): SerializedLine {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    accountId: line.accountId,
    accountCode: line.account?.code,
    accountName: line.account?.name,
    description: line.description,
    debit: toPence(line.debit),
    credit: toPence(line.credit),
    projectId: line.projectId,
    phaseId: line.phaseId,
    milestoneId: line.milestoneId,
  };
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: Money;
  incomeAccountId: string | null;
  isArchived: boolean;
  incomeAccount?: { code: string; name: string } | null;
}

export function serializeProduct(product: ProductRow) {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    unit: product.unit,
    unitPrice: toPence(product.unitPrice),
    incomeAccountId: product.incomeAccountId,
    incomeAccountCode: product.incomeAccount?.code ?? null,
    incomeAccountName: product.incomeAccount?.name ?? null,
    isArchived: product.isArchived,
  };
}

export type SerializedProduct = ReturnType<typeof serializeProduct>;

interface InvoiceLineRow {
  id: string;
  lineNumber: number;
  productId: string | null;
  code: string | null;
  name: string;
  description: string | null;
  unit: string;
  quantity: { toFixed(): string } | string | number;
  unitPrice: Money;
  amount: Money;
  incomeAccountId: string | null;
  vatCode: string | null;
}

interface InvoiceRow {
  id: string;
  number: string | null;
  status: string;
  contactId: string;
  issueDate: Date;
  paymentTermsDays: number;
  dueDate: Date;
  sentAt: Date | null;
  reference: string | null;
  notes: string | null;
  billToName: string;
  billToAddress: string | null;
  shipToAddress: string | null;
  taxId: string | null;
  subtotal: Money;
  total: Money;
  projectId: string | null;
  journalEntryId: string | null;
  isImported: boolean;
  approvedAt: Date | null;
  createdAt: Date;
  lines?: InvoiceLineRow[];
  journalEntry?: { id: string; number: number | null } | null;
  contact?: { id: string; name: string } | null;
  /** Include these (`settlementInclude`) to report what is settled and still due. */
  creditAllocations?: AllocationRow[];
  paymentAllocations?: PaymentAllocationRow[];
}

interface PaymentAllocationRow {
  id?: string;
  amount: Money;
  date?: Date;
  releasedOn?: Date | null;
  payment?: { id: string; date: Date; reference: string | null } | null;
}

function serializePaymentOnInvoice(row: PaymentAllocationRow) {
  return {
    id: row.id ?? null,
    amount: toPence(row.amount),
    date: row.date ? ledgerDateKey(row.date) : null,
    paymentId: row.payment?.id ?? null,
    paymentDate: row.payment ? ledgerDateKey(row.payment.date) : null,
    reference: row.payment?.reference ?? null,
  };
}

interface AllocationRow {
  id?: string;
  amount: Money;
  date?: Date;
  /** Set once a void released it: shown as history, never counted. */
  releasedOn?: Date | null;
  creditNote?: { id: string; number: string | null } | null;
  invoice?: { id: string; number: string | null } | null;
  refund?: { id: string; date: Date } | null;
}

function serializeDocumentLine(line: InvoiceLineRow) {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    productId: line.productId,
    code: line.code,
    name: line.name,
    description: line.description,
    unit: line.unit,
    // The exact decimal as stored: "0.5", not 0.5 through a float.
    quantity: typeof line.quantity === "object" ? line.quantity.toFixed() : String(line.quantity),
    unitPrice: toPence(line.unitPrice),
    amount: toPence(line.amount),
    incomeAccountId: line.incomeAccountId,
    vatCode: line.vatCode,
  };
}

function serializeAllocation(allocation: AllocationRow) {
  return {
    id: allocation.id ?? null,
    amount: toPence(allocation.amount),
    date: allocation.date ? ledgerDateKey(allocation.date) : null,
    creditNoteId: allocation.creditNote?.id ?? null,
    creditNoteNumber: allocation.creditNote?.number ?? null,
    invoiceId: allocation.invoice?.id ?? null,
    invoiceNumber: allocation.invoice?.number ?? null,
    refundId: allocation.refund?.id ?? null,
    releasedOn: allocation.releasedOn ? ledgerDateKey(allocation.releasedOn) : null,
  };
}

/** Only allocations still in force count; released ones are history. */
const sumAllocations = (rows: AllocationRow[] | undefined): Pence =>
  (rows ?? []).reduce((sum, row) => (row.releasedOn ? sum : sum + toPence(row.amount)), 0);

/** The row shown in a list: no lines, so a page of 50 stays small. */
export function serializeInvoiceRow(invoice: InvoiceRow) {
  const total = toPence(invoice.total);
  const credited = sumAllocations(invoice.creditAllocations);
  const paid = sumAllocations(invoice.paymentAllocations);
  const open = invoice.status !== "DRAFT" && invoice.status !== "VOID";
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    contactId: invoice.contactId,
    billToName: invoice.billToName,
    issueDate: ledgerDateKey(invoice.issueDate),
    dueDate: ledgerDateKey(invoice.dueDate),
    paymentTermsDays: invoice.paymentTermsDays,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    reference: invoice.reference,
    total,
    credited,
    paid,
    /** What the customer still owes; nothing on a draft or a void. */
    amountDue: open ? Math.max(0, total - credited - paid) : 0,
    isImported: invoice.isImported,
  };
}

export function serializeInvoice(invoice: InvoiceRow) {
  return {
    ...serializeInvoiceRow(invoice),
    notes: invoice.notes,
    billToAddress: invoice.billToAddress,
    shipToAddress: invoice.shipToAddress,
    taxId: invoice.taxId,
    subtotal: toPence(invoice.subtotal),
    projectId: invoice.projectId,
    journalEntryId: invoice.journalEntryId,
    journalNumber: invoice.journalEntry?.number ?? null,
    approvedAt: invoice.approvedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    lines: invoice.lines?.map(serializeDocumentLine),
    credits: invoice.creditAllocations?.map(serializeAllocation) ?? [],
    payments: invoice.paymentAllocations?.map(serializePaymentOnInvoice) ?? [],
  };
}

export type SerializedInvoice = ReturnType<typeof serializeInvoice>;

interface CreditNoteRow {
  id: string;
  number: string | null;
  status: string;
  contactId: string;
  invoiceId: string | null;
  issueDate: Date;
  reference: string | null;
  notes: string | null;
  billToName: string;
  billToAddress: string | null;
  shipToAddress: string | null;
  taxId: string | null;
  subtotal: Money;
  total: Money;
  projectId: string | null;
  journalEntryId: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  lines?: InvoiceLineRow[];
  journalEntry?: { id: string; number: number | null } | null;
  invoice?: { id: string; number: string | null } | null;
  /** Include these to report how much of the credit is still unallocated. */
  allocations?: AllocationRow[];
}

export function serializeCreditNoteRow(note: CreditNoteRow) {
  const total = toPence(note.total);
  const allocated = sumAllocations(note.allocations);
  return {
    id: note.id,
    number: note.number,
    status: note.status,
    contactId: note.contactId,
    billToName: note.billToName,
    invoiceId: note.invoiceId,
    invoiceNumber: note.invoice?.number ?? null,
    issueDate: ledgerDateKey(note.issueDate),
    reference: note.reference,
    total,
    allocated,
    /** Credit the customer still has to use; only an approved note has any. */
    remaining: note.status === "APPROVED" ? Math.max(0, total - allocated) : 0,
  };
}

export function serializeCreditNote(note: CreditNoteRow) {
  return {
    ...serializeCreditNoteRow(note),
    notes: note.notes,
    billToAddress: note.billToAddress,
    shipToAddress: note.shipToAddress,
    taxId: note.taxId,
    subtotal: toPence(note.subtotal),
    projectId: note.projectId,
    journalEntryId: note.journalEntryId,
    journalNumber: note.journalEntry?.number ?? null,
    approvedAt: note.approvedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    lines: note.lines?.map(serializeDocumentLine),
    allocations: note.allocations?.map(serializeAllocation) ?? [],
  };
}

export type SerializedCreditNote = ReturnType<typeof serializeCreditNote>;

interface EntryRow {
  id: string;
  number: number | null;
  date: Date;
  reference: string | null;
  memo: string;
  status: string;
  sourceType: string;
  sourceId: string | null;
  reversesId: string | null;
  postedAt: Date | null;
  createdAt: Date;
  lines?: LineRow[];
  reversedBy?: { id: string; number: number | null } | null;
  postedBy?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
}

export function serializeEntry(entry: EntryRow) {
  const lines = entry.lines?.map(serializeLine);
  return {
    id: entry.id,
    number: entry.number,
    date: ledgerDateKey(entry.date),
    reference: entry.reference,
    memo: entry.memo,
    status: entry.status,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    reversesId: entry.reversesId,
    reversedBy: entry.reversedBy ?? null,
    postedAt: entry.postedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    postedBy: entry.postedBy ?? null,
    createdBy: entry.createdBy ?? null,
    lines,
    totalDebit: lines?.reduce((s, l) => s + l.debit, 0),
    totalCredit: lines?.reduce((s, l) => s + l.credit, 0),
  };
}

interface PaymentRow {
  id: string;
  kind: string;
  status: string;
  contactId: string;
  date: Date;
  amount: Money;
  bankAccountId: string;
  reference: string | null;
  notes: string | null;
  journalEntryId: string;
  voidedAt: Date | null;
  createdAt: Date;
  contact?: { id: string; name: string } | null;
  bankAccount?: { id: string; code: string; name: string } | null;
  journalEntry?: { id: string; number: number | null } | null;
  /** Receipt side: where the money went (invoices, or refunds of it). */
  allocations?: {
    id?: string;
    amount: Money;
    date?: Date;
    releasedOn?: Date | null;
    invoice?: { id: string; number: string | null } | null;
    refund?: { id: string; date: Date } | null;
  }[];
  /** Refund side: what it paid back. */
  refundSources?: {
    amount: Money;
    releasedOn: Date | null;
    payment: { id: string; date: Date; reference: string | null };
  }[];
  creditRefunds?: { amount: Money; releasedOn: Date | null; creditNote: { id: string; number: string | null } }[];
}

export function serializePaymentRow(payment: PaymentRow) {
  const amount = toPence(payment.amount);
  const allocated = sumAllocations(payment.allocations);
  return {
    id: payment.id,
    kind: payment.kind,
    status: payment.status,
    contactId: payment.contactId,
    contactName: payment.contact?.name ?? null,
    date: ledgerDateKey(payment.date),
    amount,
    reference: payment.reference,
    allocated,
    /** A posted receipt's money not yet applied or refunded: the customer's credit. */
    remaining: payment.kind === "RECEIPT" && payment.status === "POSTED" ? Math.max(0, amount - allocated) : 0,
  };
}

export function serializePayment(payment: PaymentRow) {
  return {
    ...serializePaymentRow(payment),
    notes: payment.notes,
    bankAccountId: payment.bankAccountId,
    bankAccountCode: payment.bankAccount?.code ?? null,
    bankAccountName: payment.bankAccount?.name ?? null,
    journalEntryId: payment.journalEntryId,
    journalNumber: payment.journalEntry?.number ?? null,
    voidedAt: payment.voidedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    allocations: (payment.allocations ?? []).map((a) => ({
      id: a.id ?? null,
      amount: toPence(a.amount),
      date: a.date ? ledgerDateKey(a.date) : null,
      invoiceId: a.invoice?.id ?? null,
      invoiceNumber: a.invoice?.number ?? null,
      refundId: a.refund?.id ?? null,
      releasedOn: a.releasedOn ? ledgerDateKey(a.releasedOn) : null,
    })),
    /** For a refund: the receipt or credit note whose credit it paid back. */
    refundOf: [
      ...(payment.refundSources ?? []).map((s) => ({
        amount: toPence(s.amount),
        paymentId: s.payment.id,
        creditNoteId: null as string | null,
        label: `Payment of ${ledgerDateKey(s.payment.date)}${s.payment.reference ? ` (${s.payment.reference})` : ""}`,
      })),
      ...(payment.creditRefunds ?? []).map((s) => ({
        amount: toPence(s.amount),
        paymentId: null as string | null,
        creditNoteId: s.creditNote.id,
        label: `Credit note ${s.creditNote.number}`,
      })),
    ],
  };
}

export type SerializedPayment = ReturnType<typeof serializePayment>;

interface BankAccountRow {
  id: string;
  name: string;
  ledgerAccountId: string;
  sortCode: string;
  accountNumber: string;
  isArchived: boolean;
  ledgerAccount?: { code: string; name: string } | null;
}

/**
 * The account number goes out masked to its last four digits; the full
 * number is only needed to check a file, which happens on the server.
 */
export function serializeBankAccount(
  account: BankAccountRow,
  position?: { statementBalance: Pence | null; statementDate: string | null; booksBalance: Pence; unreconciled: number }
) {
  return {
    id: account.id,
    name: account.name,
    ledgerAccountId: account.ledgerAccountId,
    ledgerAccountCode: account.ledgerAccount?.code ?? null,
    ledgerAccountName: account.ledgerAccount?.name ?? null,
    sortCode: `${account.sortCode.slice(0, 2)}-${account.sortCode.slice(2, 4)}-${account.sortCode.slice(4)}`,
    accountNumberMasked: maskedNumberOrUnreadable(account.accountNumber, bankAccountNumberContext(account.id)),
    isArchived: account.isArchived,
    ...(position ?? {}),
  };
}

export type SerializedBankAccount = ReturnType<typeof serializeBankAccount>;
