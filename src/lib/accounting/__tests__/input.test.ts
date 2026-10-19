import { describe, it, expect } from "vitest";
import { toLineDrafts } from "@/lib/accounting/input";
import { AccountingError } from "@/lib/accounting/errors";

const account = "11111111-1111-4111-8111-111111111111";

describe("toLineDrafts", () => {
  it("converts pounds to pence and fills in the missing side", () => {
    expect(toLineDrafts([{ accountId: account, debit: "1250.75" }])).toEqual([
      {
        accountId: account,
        debit: 125075,
        credit: 0,
        description: null,
        projectId: null,
        phaseId: null,
        milestoneId: null,
      },
    ]);
  });

  it("treats blank and null amounts as zero", () => {
    const [line] = toLineDrafts([{ accountId: account, debit: "", credit: null }]);
    expect([line.debit, line.credit]).toEqual([0, 0]);
  });

  it("keeps tracking dimensions and descriptions", () => {
    const [line] = toLineDrafts([
      { accountId: account, credit: 10, description: "Rent", projectId: "p1", phaseId: "ph1", milestoneId: "m1" },
    ]);
    expect(line).toMatchObject({ credit: 1000, description: "Rent", projectId: "p1", phaseId: "ph1", milestoneId: "m1" });
  });

  it("reports which line had an unparseable amount", () => {
    try {
      toLineDrafts([
        { accountId: account, debit: "100.00" },
        { accountId: account, credit: "1,000" },
      ]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AccountingError);
      const problems = (error as AccountingError).problems;
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ code: "INVALID_AMOUNT", line: 2 });
    }
  });
});
