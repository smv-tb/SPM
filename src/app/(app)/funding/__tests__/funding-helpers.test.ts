import { describe, it, expect } from "vitest";
import {
  filterFundingRecords,
  splitFundingSections,
  fundingTotals,
  formatFundingDate,
} from "../funding-helpers";

const none = { search: "", type: "", section: "", verified: "" };
const records = [
  { id: "1", section: "FOUNDER", fundName: "Seed", source: "Founder", type: "BOOTSTRAP", amount: 100, verified: true },
  { id: "2", section: "LIVE", fundName: "Innovate Grant", source: "UKRI", type: "GRANT", amount: 200, verified: false },
  { id: "3", section: "PIPELINE", stage: "PROPOSAL", fundName: "Angel", source: "Fund X", type: "INVESTMENT", amount: 400, verified: false },
  { id: "4", section: "PIPELINE", stage: "WITHDRAWN", fundName: "Old bid", source: "Fund Y", type: "GRANT", amount: 800, verified: false },
];

describe("filterFundingRecords", () => {
  it("returns everything with no filters", () => {
    expect(filterFundingRecords(records, none)).toHaveLength(4);
  });
  it("searches name, source and type case-insensitively", () => {
    expect(filterFundingRecords(records, { ...none, search: "ukri" }).map(r => r.id)).toEqual(["2"]);
    expect(filterFundingRecords(records, { ...none, search: "invest" }).map(r => r.id)).toEqual(["3"]);
  });
  it("combines type, section and verified filters", () => {
    expect(filterFundingRecords(records, { ...none, type: "GRANT", section: "LIVE" }).map(r => r.id)).toEqual(["2"]);
    expect(filterFundingRecords(records, { ...none, verified: "true" }).map(r => r.id)).toEqual(["1"]);
    expect(filterFundingRecords(records, { ...none, verified: "false" })).toHaveLength(3);
  });
});

describe("sections and totals", () => {
  const sections = splitFundingSections(records);
  it("keeps untracked pipeline records out of PIPELINE but visible as WITHDRAWN", () => {
    expect(sections.PIPELINE.map(r => r.id)).toEqual(["3"]);
    expect(sections.WITHDRAWN.map(r => r.id)).toEqual(["4"]);
  });
  it("never counts untracked records in any total", () => {
    expect(fundingTotals(records, sections)).toEqual({ FOUNDER: 100, LIVE: 200, PIPELINE: 400, ALL: 700 });
  });
});

describe("formatFundingDate", () => {
  it("formats dd/mm/yyyy and shows a dash for missing or invalid dates", () => {
    expect(formatFundingDate("2026-03-05T12:00:00")).toBe("05/03/2026");
    expect(formatFundingDate(null)).toBe("—");
    expect(formatFundingDate("nope")).toBe("—");
  });
});
