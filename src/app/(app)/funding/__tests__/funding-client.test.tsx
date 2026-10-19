import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FundingClient } from "../funding-client";

/**
 * Covers the Records / Pipeline view toggle, which has no test and is easy to
 * break from a distance — the two views share filter state, and a record that
 * falls out of the filtered set disappears from both.
 */

function record(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    fundId: "F001",
    fundName: "Innovate UK",
    type: "GRANT",
    section: "LIVE",
    source: "UKRI",
    date: "2026-01-15T00:00:00.000Z",
    periodStart: null,
    periodEnd: null,
    amount: 25000,
    currency: "GBP",
    verified: true,
    stage: null,
    probability: null,
    deadline: null,
    nextAction: null,
    nextActionDate: null,
    ...over,
  };
}

const records = [
  record({ id: "r1", fundId: "F001", fundName: "Innovate UK", section: "LIVE" }),
  record({ id: "r2", fundId: "F002", fundName: "Founder Loan", section: "FOUNDER", type: "BOOTSTRAP" }),
  record({ id: "r3", fundId: "F003", fundName: "Horizon Europe", section: "PIPELINE", stage: "SUBMITTED", probability: 40 }),
  record({ id: "r4", fundId: "F004", fundName: "Unstaged Bid", section: "PIPELINE", stage: null }),
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("analytics")) {
        return { ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) };
      }
      if (String(url).includes("forecast=true")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            weightedForecast: 10000,
            totalPipeline: 50000,
            byStage: {
              PROSPECT: { count: 1, totalAmount: 25000, weightedAmount: 2500 },
              PREPARING: { count: 0, totalAmount: 0, weightedAmount: 0 },
              SUBMITTED: { count: 1, totalAmount: 25000, weightedAmount: 10000 },
              IN_REVIEW: { count: 0, totalAmount: 0, weightedAmount: 0 },
              AWARDED: { count: 0, totalAmount: 0, weightedAmount: 0 },
              REJECTED: { count: 0, totalAmount: 0, weightedAmount: 0 },
              WITHDRAWN: { count: 0, totalAmount: 0, weightedAmount: 0 },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ LIVE: [], FOUNDER: [], PIPELINE: [] }) };
    })
  );
});

describe("FundingClient view toggle", () => {
  it("shows record sections in the default Records view", async () => {
    render(<FundingClient initialRecords={records} projectId="p1" />);
    expect(await screen.findByText(/Section 0 — Founder Investment/)).toBeInTheDocument();
    expect(screen.getByText(/Section 1 — Live/)).toBeInTheDocument();
  });

  it("switches to the Kanban board when Pipeline is clicked", async () => {
    render(<FundingClient initialRecords={records} projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pipeline/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Section 0 — Founder Investment/)).not.toBeInTheDocument();
    });
    // Stage columns are the board's signature.
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Prospect")).toBeInTheDocument();
  });

  it("switches back to Records", async () => {
    render(<FundingClient initialRecords={records} projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pipeline/i }));
    await waitFor(() => expect(screen.getByText("Submitted")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Records/i }));
    expect(await screen.findByText(/Section 0 — Founder Investment/)).toBeInTheDocument();
  });

  it("shows an unstaged pipeline record on the board rather than losing it", async () => {
    render(<FundingClient initialRecords={records} projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pipeline/i }));
    // r4 has stage: null — it must appear under Prospect, not vanish.
    expect(await screen.findByText("Unstaged Bid")).toBeInTheDocument();
  });

  it("keeps both views usable when the analytics request fails", async () => {
    // Analytics 401s in this suite's fetch stub. A failure there must not take
    // the rest of the page down with it.
    render(<FundingClient initialRecords={records} projectId="p1" />);
    expect(await screen.findByText(/Section 1 — Live/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pipeline/i }));
    expect(await screen.findByText("Submitted")).toBeInTheDocument();
  });

  it("renders the record table rows themselves, not just the section headers", async () => {
    render(<FundingClient initialRecords={records} projectId="p1" />);
    expect(await screen.findByText("Innovate UK")).toBeInTheDocument();
    expect(screen.getByText("Founder Loan")).toBeInTheDocument();
  });

  it("survives an analytics payload that is missing fields", async () => {
    // The reported "Records and Pipeline tabs do nothing" bug: analytics
    // returned 200 with a body lacking overdueTranches, the render threw on
    // `.length`, and React unmounted the entire page — both views included.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("analytics")) {
          return { ok: true, status: 200, json: async () => ({ securedCash: 1000 }) };
        }
        return { ok: true, status: 200, json: async () => ({ LIVE: [], FOUNDER: [], PIPELINE: [] }) };
      })
    );

    render(<FundingClient initialRecords={records} projectId="p1" />);

    expect(await screen.findByText("Innovate UK")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pipeline/i }));
    expect(await screen.findByText("Horizon Europe")).toBeInTheDocument();
  });

  it("survives an analytics payload that is not an object at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("analytics")) {
          return { ok: true, status: 200, json: async () => null };
        }
        return { ok: true, status: 200, json: async () => ({ LIVE: [], FOUNDER: [], PIPELINE: [] }) };
      })
    );

    render(<FundingClient initialRecords={records} projectId="p1" />);
    expect(await screen.findByText("Innovate UK")).toBeInTheDocument();
  });
});
