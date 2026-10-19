import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/accounting/chart";

/**
 * Request shapes for the books API.
 *
 * Amounts stay as the caller wrote them here (string or number, in pounds) and
 * are converted to integer pence by `toLineDrafts` — one place that knows how
 * money is parsed, rather than a `z.coerce.number()` that would quietly turn
 * "1.005" into a float.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");

const amount = z.union([z.string(), z.number()]);

export const AccountTypeEnum = z.enum(ACCOUNT_TYPES);

export const accountCreateSchema = z.object({
  code: z.string().regex(/^\d{4}$/, "Account codes are four digits"),
  name: z.string().min(1, "Name is required").max(120),
  type: AccountTypeEnum,
  description: z.string().max(500).nullable().optional(),
});

export const accountUpdateSchema = z
  .object({
    code: z.string().regex(/^\d{4}$/, "Account codes are four digits").optional(),
    name: z.string().min(1, "Name is required").max(120).optional(),
    type: AccountTypeEnum.optional(),
    description: z.string().max(500).nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const journalLineSchema = z.object({
  accountId: z.string().uuid("Invalid account"),
  debit: amount.nullable().optional(),
  credit: amount.nullable().optional(),
  description: z.string().max(300).nullable().optional(),
  // Tracking dimensions are not UUID-validated: legacy phases and projects
  // carry slug-style ids from the ODS migration (same reasoning as funding).
  projectId: z.string().min(1).nullable().optional(),
  phaseId: z.string().min(1).nullable().optional(),
  milestoneId: z.string().min(1).nullable().optional(),
});

export const journalSchema = z.object({
  date: dateOnly,
  memo: z.string().min(1, "A description is required").max(300),
  reference: z.string().max(100).nullable().optional(),
  lines: z.array(journalLineSchema).min(1, "Add at least one line").max(200),
  /** Post immediately rather than leaving a draft. */
  post: z.boolean().default(false),
});

export const journalReverseSchema = z.object({
  date: dateOnly,
  memo: z.string().max(300).nullable().optional(),
});

export const companySettingsSchema = z
  .object({
    legalName: z.string().max(200).optional(),
    companyNumber: z.string().max(20).nullable().optional(),
    vatNumber: z.string().max(20).nullable().optional(),
    vatRegistered: z.boolean().optional(),
    baseCurrency: z.string().length(3, "Use a 3-letter currency code").optional(),
    yearStartMonth: z.number().int().min(1).max(12).optional(),
    // Capped at 28 so the financial year starts on a day that exists every year.
    yearStartDay: z.number().int().min(1).max(28).optional(),
    invoicePrefix: z.string().regex(/^[A-Z0-9-]{0,10}$/, "Use capitals, digits or -").optional(),
    nextInvoiceNumber: z.number().int().min(1).optional(),
    invoiceNumberPad: z.number().int().min(1).max(10).optional(),
    creditNotePrefix: z.string().regex(/^[A-Z0-9-]{0,10}$/, "Use capitals, digits or -").optional(),
    nextCreditNoteNumber: z.number().int().min(1).optional(),
    registeredAddress: z.string().max(600).nullable().optional(),
    placeOfRegistration: z.string().max(100).nullable().optional(),
    bankAccountName: z.string().max(120).nullable().optional(),
    bankSortCode: z.string().max(10).nullable().optional(),
    bankAccountNumber: z.string().max(20).nullable().optional(),
    requireSecondApprover: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const ContactTypeEnum = z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]);

// Addresses are free text: a UK address, a French one and a "care of" line do
// not share a set of fields worth enforcing.
const address = z.string().max(600).nullable().optional();
const contactName = z.string().min(1, "A name is required").max(200);
// 0 = due on receipt. The cap is a typo guard; the same range is a CHECK.
const paymentTerms = z.number().int().min(0).max(365, "Terms longer than a year are probably a typo");

export const contactCreateSchema = z.object({
  type: ContactTypeEnum.default("CUSTOMER"),
  name: contactName,
  email: z.string().email("Not a valid email address").max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  taxId: z.string().max(40).nullable().optional(),
  billingAddress: address,
  shippingAddress: address,
  paymentTermsDays: paymentTerms.default(0),
  notes: z.string().max(2000).nullable().optional(),
});

export const contactUpdateSchema = z
  .object({
    type: ContactTypeEnum.optional(),
    name: contactName.optional(),
    email: z.string().email("Not a valid email address").max(200).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    taxId: z.string().max(40).nullable().optional(),
    billingAddress: address,
    shippingAddress: address,
    paymentTermsDays: paymentTerms.optional(),
    notes: z.string().max(2000).nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const productName = z.string().min(1, "A name is required").max(200);
const productUnit = z.string().min(1, "A unit is required").max(30);
// Codes are normalised and validated by `sales.ts`; length is all Zod checks.
const productCode = z.string().min(1, "A code is required").max(24);

export const productCreateSchema = z.object({
  code: productCode,
  name: productName,
  description: z.string().max(1000).nullable().optional(),
  unit: productUnit.default("item"),
  unitPrice: amount.optional(),
  incomeAccountId: z.string().uuid("Invalid account").nullable().optional(),
});

export const productUpdateSchema = z
  .object({
    code: productCode.optional(),
    name: productName.optional(),
    description: z.string().max(1000).nullable().optional(),
    unit: productUnit.optional(),
    unitPrice: amount.optional(),
    incomeAccountId: z.string().uuid("Invalid account").nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** Quantities, like amounts, stay as written until `toInvoiceLines` parses them. */
const quantity = z.union([z.string(), z.number()]);

export const invoiceLineSchema = z.object({
  // Not UUID-validated: the id is a foreign key we never parse, and imported
  // catalogues can carry ids of their own (same reasoning as funding ids).
  productId: z.string().min(1).nullable().optional(),
  code: z.string().max(24).nullable().optional(),
  name: z.string().min(1, "Every line needs a name").max(200),
  description: z.string().max(1000).nullable().optional(),
  unit: productUnit.default("item"),
  quantity,
  unitPrice: amount,
  incomeAccountId: z.string().uuid("Invalid account").nullable().optional(),
  vatCode: z.string().max(20).nullable().optional(),
});

export const invoiceSchema = z.object({
  contactId: z.string().uuid("Choose a customer"),
  issueDate: dateOnly,
  /** Omitted takes the customer's own terms. */
  paymentTermsDays: paymentTerms.optional(),
  reference: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Tracking dimension: legacy project ids are not UUIDs (see journal lines).
  projectId: z.string().min(1).nullable().optional(),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line").max(200),
  /** Approve immediately rather than leaving a draft. */
  approve: z.boolean().default(false),
});

export const invoiceSendSchema = z.object({
  /** Defaults to today: "sent on" is when it actually went out. */
  sentAt: dateOnly.optional(),
});

export const invoiceVoidSchema = z.object({
  reason: z.string().min(1, "Say why it is being voided").max(300),
});

export const creditNoteSchema = z.object({
  contactId: z.string().uuid("Choose a customer"),
  /** The invoice being corrected; null for credit not tied to one. */
  invoiceId: z.string().uuid("Invalid invoice").nullable().optional(),
  issueDate: dateOnly,
  reference: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line").max(200),
  approve: z.boolean().default(false),
});

export const creditAllocationSchema = z.object({
  invoiceId: z.string().uuid("Choose an invoice"),
  /** Pounds, as written. Omitted applies as much as both documents allow. */
  amount: amount.optional(),
  date: dateOnly.optional(),
});

export const paymentSchema = z.object({
  contactId: z.string().uuid("Choose a customer"),
  date: dateOnly,
  /** Pounds, as written; parsed to pence by the route. */
  amount,
  /** A 12xx bank account; omitted means 1200. */
  bankAccountId: z.string().uuid("Invalid account").nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /**
   * Money-in statement line this payment is. The line's own date, amount and
   * bank account are used and the line is reconciled in the same step.
   */
  statementLineId: z.string().uuid("Invalid statement line").nullable().optional(),
  /** Invoices to settle, in order; an omitted amount takes what each still owes. */
  allocations: z
    .array(z.object({ invoiceId: z.string().uuid("Invalid invoice"), amount: amount.optional() }))
    .max(50)
    .default([]),
});

export const refundSchema = z.object({
  source: z.union([
    z.object({ creditNoteId: z.string().uuid("Invalid credit note") }),
    z.object({ paymentId: z.string().uuid("Invalid payment") }),
  ]),
  date: dateOnly,
  /** Omitted refunds everything the source has left. */
  amount: amount.optional(),
  bankAccountId: z.string().uuid("Invalid account").nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const bankAccountCreateSchema = z.object({
  name: z.string().min(1, "Give the account a name").max(100),
  ledgerAccountId: z.string().uuid("Choose the ledger account it books to"),
  sortCode: z.string().regex(/^\s*\d{2}-?\d{2}-?\d{2}\s*$/, "A sort code is six digits, e.g. 30-99-50"),
  accountNumber: z.string().regex(/^\s*\d{8}\s*$/, "An account number is eight digits"),
});

export const bankAccountUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    sortCode: bankAccountCreateSchema.shape.sortCode.optional(),
    accountNumber: bankAccountCreateSchema.shape.accountNumber.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** How to read a statement file; sent with an upload as a JSON form field. */
export const importProfileSchema = z.object({
  columns: z.record(
    z.enum(["date", "type", "sortCode", "accountNumber", "description", "debit", "credit", "balance"]),
    z.string().max(100).nullable()
  ),
  dateFormat: z.enum(["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]),
  numberFormat: z.enum(["UK", "EU"]),
});

const ids = (label: string) => z.array(z.string().uuid(label)).min(1).max(50);

export const reconcileMatchSchema = z.object({
  statementLineIds: ids("Invalid statement line"),
  journalLineIds: ids("Invalid book entry"),
});

export const reconcileInvoicesSchema = z.object({
  statementLineId: z.string().uuid("Invalid statement line"),
  invoiceIds: ids("Invalid invoice"),
});

export const reconcileCreateSchema = z.object({
  statementLineId: z.string().uuid("Invalid statement line"),
  accountId: z.string().uuid("Choose an account"),
  memo: z.string().max(300).nullable().optional(),
});

export const lockDateSchema = z.object({
  lockDate: dateOnly.nullable(),
  /** Required when unlocking or moving the lock earlier; recorded in the audit log. */
  reason: z.string().max(300).nullable().optional(),
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type JournalLineInput = z.infer<typeof journalLineSchema>;
export type JournalInput = z.infer<typeof journalSchema>;
export type JournalReverseInput = z.infer<typeof journalReverseSchema>;
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type InvoiceLineRequest = z.infer<typeof invoiceLineSchema>;
export type InvoiceRequest = z.infer<typeof invoiceSchema>;
export type InvoiceSendInput = z.infer<typeof invoiceSendSchema>;
export type InvoiceVoidInput = z.infer<typeof invoiceVoidSchema>;
export type CreditNoteRequest = z.infer<typeof creditNoteSchema>;
export type CreditAllocationRequest = z.infer<typeof creditAllocationSchema>;
export type PaymentRequest = z.infer<typeof paymentSchema>;
export type RefundRequest = z.infer<typeof refundSchema>;
export type LockDateInput = z.infer<typeof lockDateSchema>;
