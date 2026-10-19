import { MoneyError, toPence } from "@/lib/money";
import type { InvoiceLineRequest, JournalLineInput } from "@/schemas/books";
import { AccountingError, type JournalProblem, type RuleProblem } from "./errors";
import type { JournalLineDraft } from "./journal";
import type { InvoiceLineInput } from "./invoice";
import { toMilli } from "./sales";

/**
 * Converts submitted journal lines into the integer-pence drafts the posting
 * service works with.
 *
 * Amount parsing is deliberately strict (`toPence` rejects "1,200" and "£5"),
 * so this reports which line was wrong rather than failing the whole request
 * with one opaque message.
 */
export function toLineDrafts(lines: JournalLineInput[]): JournalLineDraft[] {
  const problems: JournalProblem[] = [];

  const drafts = lines.map((line, i) => {
    const parse = (value: string | number | null | undefined): number => {
      if (value === null || value === undefined || value === "") return 0;
      try {
        return toPence(value);
      } catch (error) {
        problems.push({
          code: "INVALID_AMOUNT",
          message: error instanceof MoneyError ? error.message : "Invalid amount",
          line: i + 1,
        });
        return 0;
      }
    };

    return {
      accountId: line.accountId,
      debit: parse(line.debit),
      credit: parse(line.credit),
      description: line.description ?? null,
      projectId: line.projectId ?? null,
      phaseId: line.phaseId ?? null,
      milestoneId: line.milestoneId ?? null,
    };
  });

  if (problems.length > 0) {
    throw new AccountingError("INVALID_JOURNAL", "Journal has invalid amounts", 422, problems);
  }
  return drafts;
}

/**
 * Converts submitted invoice lines into the integer-quantity, integer-pence
 * shape the invoice service works with. Same reasoning as `toLineDrafts`:
 * parsing is strict, and the failure names the line that was wrong.
 */
export function toInvoiceLines(lines: InvoiceLineRequest[]): InvoiceLineInput[] {
  const problems: RuleProblem[] = [];

  const drafts = lines.map((line, i) => {
    const at = i + 1;
    let quantity = 0;
    let unitPrice = 0;
    try {
      quantity = toMilli(line.quantity);
    } catch (error) {
      problems.push({
        code: "INVALID_QUANTITY",
        message: error instanceof MoneyError ? error.message : "Invalid quantity",
        line: at,
      });
    }
    try {
      unitPrice = toPence(line.unitPrice);
    } catch (error) {
      problems.push({
        code: "INVALID_AMOUNT",
        message: error instanceof MoneyError ? error.message : "Invalid price",
        line: at,
      });
    }

    return {
      name: line.name,
      description: line.description ?? null,
      code: line.code ?? null,
      unit: line.unit,
      quantity,
      unitPrice,
      productId: line.productId ?? null,
      incomeAccountId: line.incomeAccountId ?? null,
      vatCode: line.vatCode ?? null,
    };
  });

  if (problems.length > 0) {
    throw new AccountingError("INVALID_INVOICE", "Invoice has invalid figures", 422, problems);
  }
  return drafts;
}

/**
 * One submitted amount (pounds, as written) to pence, strictly. A bad value
 * is a 422 naming the field, not a 500 or a silently rounded float.
 */
export function parseAmount(value: string | number, field = "Amount"): number {
  try {
    return toPence(value);
  } catch (error) {
    throw new AccountingError(
      "INVALID_AMOUNT",
      `${field}: ${error instanceof MoneyError ? error.message : "not a valid amount"}`,
      422
    );
  }
}
