import { Prisma } from "@prisma/client";
import { financialYearContaining } from "./dates";
import { COMPANY_SETTINGS_ID } from "./posting";
import { loadProfitAndLoss } from "./profit-and-loss-query";
import { periodRequest } from "./report-request";
import { profitAndLossRows, type ProfitAndLoss } from "./profit-and-loss";
import type { ReportRow } from "./balance-sheet";

type Reader = Pick<Prisma.TransactionClient, "companySettings" | "ledgerAccount" | "journalLine">;

/** Parse the request, load the period (and comparative) and lay the rows out. */
export async function loadProfitAndLossReport(
  db: Reader,
  params: URLSearchParams,
  includeZero: boolean
): Promise<{ reports: ProfitAndLoss[]; rows: ReportRow[]; projectId: string | null; phaseId: string | null }> {
  const settings = await db.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });
  const year = financialYearContaining(new Date(), settings?.yearStartMonth ?? 11, settings?.yearStartDay ?? 1);
  const request = periodRequest(params, year);
  const dimension = { projectId: request.projectId, phaseId: request.phaseId };
  const periods = [{ from: request.from, to: request.to }, ...(request.compare ? [request.compare] : [])];
  const reports = await Promise.all(periods.map((p) => loadProfitAndLoss(db, p.from, p.to, dimension)));
  return { reports, rows: profitAndLossRows(reports, { includeZero }), ...dimension };
}
