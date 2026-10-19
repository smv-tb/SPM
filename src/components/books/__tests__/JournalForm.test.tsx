import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JournalForm, type BooksAccount } from "../JournalForm";

/**
 * The journal form is where a person turns intentions into ledger entries, so
 * its arithmetic and its error handling are covered here rather than trusted:
 * the live totals, what is actually sent, and that a refusal from the server
 * lands against the line that caused it.
 */

const accounts: BooksAccount[] = [
  { id: "a-bank", code: "1200", name: "Business bank account", type: "ASSET" },
  { id: "a-grant", code: "4900", name: "Grant income", type: "INCOME" },
  { id: "a-rent", code: "6100", name: "Rent and rates", type: "EXPENSE" },
];

type FetchCall = { url: string; method: string; body: any };
let calls: FetchCall[];
let responses: { ok: boolean; status: number; body: unknown }[];

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = responses.shift() ?? { ok: true, status: 201, body: { id: "new" } };
      return { ok: next.ok, status: next.status, url: String(url), json: async () => next.body };
    })
  );
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function renderForm(props: Partial<Parameters<typeof JournalForm>[0]> = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(<JournalForm accounts={accounts} onSaved={onSaved} onCancel={onCancel} {...props} />);
  return { onSaved, onCancel };
}

function fillBalanced(amount = "49.99") {
  set("Description", "Software subscription");
  set("Account for line 1", "a-rent");
  set("Debit for line 1", amount);
  set("Account for line 2", "a-bank");
  set("Credit for line 2", amount);
}

describe("JournalForm totals", () => {
  it("starts with two empty lines and zero totals", () => {
    renderForm();
    expect(screen.getByLabelText("Account for line 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Account for line 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account for line 3")).not.toBeInTheDocument();
    expect(screen.getAllByText("£0.00")).toHaveLength(2);
  });

  it("warns while the journal is out of balance, and stops once it balances", () => {
    renderForm();
    fillBalanced();
    set("Credit for line 2", "40.00");
    expect(screen.getByText(/Out by £9\.99/)).toBeInTheDocument();

    set("Credit for line 2", "49.99");
    expect(screen.queryByText(/Out by/)).not.toBeInTheDocument();
    expect(screen.getAllByText("£49.99")).toHaveLength(2);
  });

  it("adds exactly, without float drift", () => {
    renderForm();
    set("Debit for line 1", "0.10");
    set("Debit for line 2", "0.20");
    expect(screen.getByText("£0.30")).toBeInTheDocument();
  });

  it("clears the credit when a debit is typed on the same line, and vice versa", () => {
    renderForm();
    set("Credit for line 1", "5.00");
    set("Debit for line 1", "3.00");
    expect(field("Credit for line 1").value).toBe("");

    set("Credit for line 1", "7.00");
    expect(field("Debit for line 1").value).toBe("");
  });

  it("only offers to remove a line when more than two remain", () => {
    renderForm();
    expect(screen.queryByLabelText(/Remove line/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add line/ }));
    expect(screen.getAllByLabelText(/Remove line/)).toHaveLength(3);

    fireEvent.click(screen.getByLabelText("Remove line 3"));
    expect(screen.queryByLabelText("Account for line 3")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove line/)).not.toBeInTheDocument();
  });
});

describe("JournalForm submission", () => {
  it("saves a draft with amounts exactly as typed and blank lines dropped", async () => {
    const { onSaved } = renderForm();
    fillBalanced("1.005");
    fireEvent.click(screen.getByRole("button", { name: /Add line/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/books/journals", method: "POST" });
    expect(calls[0].body).toMatchObject({ memo: "Software subscription", post: false, reference: null });
    // The server does the parsing; the form must not round "1.005" in a float.
    expect(calls[0].body.lines).toEqual([
      { accountId: "a-rent", description: null, debit: "1.005", credit: null },
      { accountId: "a-bank", description: null, debit: null, credit: "1.005" },
    ]);
  });

  it("posts a new journal in one request", async () => {
    const { onSaved } = renderForm();
    fillBalanced();
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0].body.post).toBe(true);
  });

  it("shows a refusal against the offending line, and does not report success", async () => {
    responses.push({
      ok: false,
      status: 422,
      body: {
        error: "Journal cannot be posted",
        problems: [
          { code: "UNBALANCED", message: "Debits (£1.00) must equal credits (£0.50)" },
          { code: "ARCHIVED_ACCOUNT", message: "6999 Old expenses is archived", line: 2 },
        ],
      },
    });
    const { onSaved } = renderForm();
    fillBalanced();
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText("Journal cannot be posted")).toBeInTheDocument();
    expect(screen.getByText("Debits (£1.00) must equal credits (£0.50)")).toBeInTheDocument();
    const lineProblem = screen.getByText("6999 Old expenses is archived");
    // Rendered in line 2's row, beside its account picker.
    expect(lineProblem.closest("tr")).toContainElement(screen.getByLabelText("Account for line 2"));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("editing a draft saves it first, then posts it", async () => {
    responses.push({ ok: true, status: 200, body: { id: "j1" } }, { ok: true, status: 200, body: { id: "j1" } });
    const { onSaved } = renderForm({
      entry: {
        id: "j1",
        date: "2026-05-10",
        memo: "Grant receipt",
        reference: "REF-1",
        lines: [
          { accountId: "a-bank", description: null, debit: 1000, credit: 0 },
          { accountId: "a-grant", description: "First tranche", debit: 0, credit: 1000 },
        ],
      },
    });

    expect(field("Debit for line 1").value).toBe("10.00");
    expect(field("Credit for line 2").value).toBe("10.00");
    expect(field("Description for line 2").value).toBe("First tranche");

    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "PUT /api/books/journals/j1",
      "POST /api/books/journals/j1/post",
    ]);
  });

  it("does not post a draft whose save was refused", async () => {
    responses.push({ ok: false, status: 409, body: { error: "Posted journals cannot be edited — reverse them instead" } });
    const { onSaved } = renderForm({
      entry: {
        id: "j1",
        date: "2026-05-10",
        memo: "Grant receipt",
        reference: null,
        lines: [
          { accountId: "a-bank", description: null, debit: 1000, credit: 0 },
          { accountId: "a-grant", description: null, debit: 0, credit: 1000 },
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText(/cannot be edited/)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
