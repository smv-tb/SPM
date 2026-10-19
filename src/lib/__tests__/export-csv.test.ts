import { describe, it, expect } from "vitest";
import { escapeCsvCell, toCsvParts } from "@/lib/export-csv";

describe("escapeCsvCell", () => {
  it("leaves ordinary values alone", () => {
    expect(escapeCsvCell("Grant income")).toBe("Grant income");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("quotes separators, quotes and newlines", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it.each([
    ["=HYPERLINK(\"http://evil\")", "'=HYPERLINK(\"\"http://evil\"\")"],
    ["+SUM(A1)", "'+SUM(A1)"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
  ])("neutralises formula-looking text %j", (input, expected) => {
    const out = escapeCsvCell(input);
    expect(out.replace(/^"|"$/g, "")).toBe(expected);
  });

  it("neutralises leading tab and carriage return", () => {
    expect(escapeCsvCell("\t=1")).toBe("'\t=1");
    expect(escapeCsvCell("\r=1")).toBe("\"'\r=1\"");
  });

  it("keeps plain negative amounts numeric", () => {
    expect(escapeCsvCell("-1250.00")).toBe("-1250.00");
    expect(escapeCsvCell(-3)).toBe("-3");
  });
});

describe("toCsvParts", () => {
  it("writes exactly one header for large exports", () => {
    const rows = Array.from({ length: 12_001 }, (_, i) => ({ id: i }));
    const csv = toCsvParts(rows).join("");
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("id");
    expect(lines.filter((l) => l === "id")).toHaveLength(1);
    expect(lines).toHaveLength(12_002);
  });

  it("uses column labels and order when given", () => {
    const csv = toCsvParts([{ a: 1, b: "x" }], [
      { key: "b", label: "Bee" },
      { key: "a", label: "Ay" },
    ]).join("");
    expect(csv).toBe("Bee,Ay\nx,1\n");
  });
});
