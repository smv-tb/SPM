import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_CHART,
  SYSTEM_ACCOUNT_CODES,
  validateAccountCode,
} from "@/lib/accounting/chart";

describe("validateAccountCode", () => {
  it("accepts codes in the type's range", () => {
    expect(validateAccountCode("1200", "ASSET")).toBeNull();
    expect(validateAccountCode("9999", "EXPENSE")).toBeNull();
  });

  it("rejects malformed or out-of-range codes", () => {
    expect(validateAccountCode("120", "ASSET")).toMatch(/four digits/);
    expect(validateAccountCode("12a0", "ASSET")).toMatch(/four digits/);
    expect(validateAccountCode("4000", "ASSET")).toMatch(/1000–1999/);
  });
});

describe("DEFAULT_CHART", () => {
  it("has unique codes that all suit their type", () => {
    const codes = DEFAULT_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of DEFAULT_CHART) expect(validateAccountCode(a.code, a.type)).toBeNull();
  });

  it("contains every system account, flagged as system", () => {
    for (const code of Object.values(SYSTEM_ACCOUNT_CODES)) {
      const account = DEFAULT_CHART.find((a) => a.code === code);
      expect(account, `system account ${code}`).toBeDefined();
      expect(account!.isSystem).toBe(true);
    }
    expect(DEFAULT_CHART.filter((a) => a.isSystem)).toHaveLength(Object.keys(SYSTEM_ACCOUNT_CODES).length);
  });

  it("matches what the general-ledger migration seeds", () => {
    const migrationsDir = path.resolve(__dirname, "../../../../prisma/migrations");
    const dir = readdirSync(migrationsDir).find((d) => d.endsWith("_add_general_ledger"));
    expect(dir, "general ledger migration").toBeDefined();
    const sql = readFileSync(path.join(migrationsDir, dir!, "migration.sql"), "utf8");

    for (const a of DEFAULT_CHART) {
      const row = `('${a.code}', '${a.name.replace(/'/g, "''")}', '${a.type}', ${a.isSystem})`;
      expect(sql, `seed row for ${a.code}`).toContain(row);
    }
  });
});
