import { clientFetch } from "@/lib/client-fetch";
import { isTrackedInPipeline } from "@/lib/funding";
import type { Accessor } from "@/hooks/use-sortable-data";

/** Must not exceed FUNDING_MAX_PAGE_LIMIT — the API silently clamps above it. */
export const FUNDING_PAGE_LIMIT = 500;

/** Reads the API's own error message off a failed response, with a status fallback. */
export async function describeFailure(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ? `${body.error} (${res.status})` : `Request failed (${res.status})`;
}

export const typeVariant: Record<string, string> = {
  BOOTSTRAP: "bg-muted text-foreground",
  GRANT: "bg-green-100 text-green-700",
  INVESTMENT: "bg-primary/10 text-primary",
  REVENUE: "bg-purple-100 text-purple-700",
  OTHER: "bg-yellow-100 text-yellow-700",
};
export const typeLabel: Record<string, string> = {
  BOOTSTRAP: "Bootstrap", GRANT: "Grant", INVESTMENT: "Investment", REVENUE: "Revenue", OTHER: "Other",
};

export const ALL_FUNDING_TYPES = ["", "BOOTSTRAP", "GRANT", "INVESTMENT", "REVENUE", "OTHER"];
export const ALL_SECTIONS = ["", "FOUNDER", "LIVE", "PIPELINE"];
export const VERIFIED_OPTIONS = [
  { value: "", label: "All" },
  { value: "true", label: "Verified" },
  { value: "false", label: "Unverified" },
];

export const fundingAccessors: Record<string, Accessor<any>> = {
  fundId: r => r.fundId,
  fundName: r => r.fundName,
  type: r => r.type,
  source: r => r.source,
  date: r => (r.date ? new Date(r.date) : null),
  amount: r => r.amount,
  verified: r => (r.verified ? 1 : 0),
};

export function formatFundingDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export interface FundingFilters {
  search: string;
  type: string;
  section: string;
  verified: string;
}

/** Applies the toolbar filters; sorting is done separately by the caller. */
export function filterFundingRecords(records: any[], f: FundingFilters): any[] {
  return records.filter(r => {
    if (f.search) {
      const q = f.search.toLowerCase();
      if (
        !r.fundName?.toLowerCase().includes(q) &&
        !r.source?.toLowerCase().includes(q) &&
        !r.type?.toLowerCase().includes(q)
      ) return false;
    }
    if (f.type && r.type !== f.type) return false;
    if (f.section && r.section !== f.section) return false;
    if (f.verified === "true" && !r.verified) return false;
    if (f.verified === "false" && r.verified) return false;
    return true;
  });
}

export function splitFundingSections(records: any[]) {
  return {
    FOUNDER: records.filter(r => r.section === "FOUNDER"),
    LIVE: records.filter(r => r.section === "LIVE"),
    PIPELINE: records.filter(r => r.section === "PIPELINE" && isTrackedInPipeline(r.stage)),
    // Kept visible (so a fund can be reopened) but never counted or tracked.
    WITHDRAWN: records.filter(r => r.section === "PIPELINE" && !isTrackedInPipeline(r.stage)),
  };
}

export function fundingTotals(records: any[], sections: ReturnType<typeof splitFundingSections>) {
  return {
    FOUNDER: sections.FOUNDER.reduce((s, r) => s + r.amount, 0),
    LIVE: sections.LIVE.reduce((s, r) => s + r.amount, 0),
    PIPELINE: sections.PIPELINE.reduce((s, r) => s + r.amount, 0),
    ALL: records
      .filter(r => r.section !== "PIPELINE" || isTrackedInPipeline(r.stage))
      .reduce((s, r) => s + r.amount, 0),
  };
}

// Walks every page rather than assuming one 500-record page covers the book —
// the SSR load is unpaginated, so a single-page refresh silently dropped any
// record past the limit from the table and from every total on the page.
export async function fetchAllFundingRecords(): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;

  do {
    const url = `/api/funding?limit=${FUNDING_PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res: Response = await clientFetch(url);
    if (!res.ok) throw new Error(`Failed to refresh (${res.status})`);
    const data = await res.json();
    all.push(...(data.FOUNDER || []), ...(data.LIVE || []), ...(data.PIPELINE || []));
    cursor = data.hasMore ? data.nextCursor : null;
  } while (cursor);

  return all;
}

export const FUNDING_CSV_COLUMNS = [
  { key: "fundId", label: "Fund ID" },
  { key: "section", label: "Section" },
  { key: "fundName", label: "Fund Name" },
  { key: "type", label: "Type" },
  { key: "source", label: "Source" },
  { key: "amount", label: "Amount (GBP)" },
  { key: "currency", label: "Currency" },
  { key: "verified", label: "Verified" },
  { key: "periodStart", label: "Period Start" },
  { key: "periodEnd", label: "Period End" },
  { key: "stage", label: "Stage" },
  { key: "probability", label: "Probability (%)" },
  { key: "deadline", label: "Deadline" },
  { key: "nextAction", label: "Next Action" },
  { key: "nextActionDate", label: "Next Action Date" },
  { key: "contactName", label: "Contact Name" },
  { key: "contactEmail", label: "Contact Email" },
  { key: "funderUrl", label: "Funder URL" },
  { key: "coverageDesc", label: "Coverage" },
  { key: "notes", label: "Notes" },
];
