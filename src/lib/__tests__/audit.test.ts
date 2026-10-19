import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import {
  actorFromSession,
  buildAuditRow,
  diffForAudit,
  requestIp,
  toAuditJson,
  HERMES_ACTOR,
} from "@/lib/audit";

/** Mimics decimal.js's shape without importing @prisma/client. */
const decimal = (str: string) => ({ s: 1, e: 0, d: [0], toFixed: () => str });

describe("toAuditJson", () => {
  it("keeps Decimals exact and serialises dates", () => {
    expect(
      toAuditJson({
        amount: decimal("12500.10"),
        date: new Date("2026-03-01T00:00:00Z"),
        skipped: undefined,
        nested: [{ n: 1n }],
      })
    ).toEqual({ amount: "12500.10", date: "2026-03-01T00:00:00.000Z", nested: [{ n: "1" }] });
  });

  it("maps non-finite numbers to strings rather than invalid JSON", () => {
    expect(toAuditJson(Number.NaN)).toBe("NaN");
  });
});

describe("diffForAudit", () => {
  it("records only fields that changed", () => {
    const { before, after } = diffForAudit(
      { id: "f1", amount: decimal("100.00"), notes: "a", verified: false },
      { id: "f1", amount: decimal("150.00"), notes: "a", verified: true }
    );
    expect(before).toEqual({ amount: "100.00", verified: false });
    expect(after).toEqual({ amount: "150.00", verified: true });
  });

  it("captures fields that appear or disappear", () => {
    const { before, after } = diffForAudit({ a: 1 }, { b: 2 });
    expect(before).toEqual({ a: 1, b: null });
    expect(after).toEqual({ a: null, b: 2 });
  });
});

describe("buildAuditRow", () => {
  const user = { type: "USER" as const, id: "u1", label: "pm@example.com" };

  it("stores a full snapshot for creates and omits the empty side", () => {
    const row = buildAuditRow({
      actor: user,
      action: "funding.create",
      entityType: "FundingRecord",
      entityId: "f1",
      after: { id: "f1", amount: decimal("10.00") },
    });
    expect(row).toMatchObject({ actorType: "USER", actorId: "u1", actorLabel: "pm@example.com" });
    expect(row.after).toEqual({ id: "f1", amount: "10.00" });
    expect("before" in row).toBe(false);
  });

  it("stores a full snapshot for deletes", () => {
    const row = buildAuditRow({
      actor: HERMES_ACTOR,
      action: "funding.delete",
      entityType: "FundingRecord",
      entityId: "f1",
      before: { id: "f1", tranches: [{ id: "t1" }] },
    });
    expect(row).toMatchObject({ actorType: "HERMES", actorId: null, actorLabel: "hermes" });
    expect(row.before).toEqual({ id: "f1", tranches: [{ id: "t1" }] });
    expect("after" in row).toBe(false);
  });

  it("diffs updates", () => {
    const row = buildAuditRow({
      actor: user,
      action: "funding.update",
      entityType: "FundingRecord",
      entityId: "f1",
      before: { id: "f1", notes: "old" },
      after: { id: "f1", notes: "new" },
    });
    expect(row.before).toEqual({ notes: "old" });
    expect(row.after).toEqual({ notes: "new" });
  });
});

describe("actorFromSession", () => {
  it("builds a user actor", () => {
    const session = { user: { id: "u1", email: "a@b.c" }, expires: "" } as unknown as Session;
    expect(actorFromSession(session)).toEqual({ type: "USER", id: "u1", label: "a@b.c" });
  });

  it("refuses a session without a user id", () => {
    const session = { user: { email: "a@b.c" }, expires: "" } as unknown as Session;
    expect(() => actorFromSession(session)).toThrow();
  });
});

describe("requestIp", () => {
  it("prefers x-real-ip, then the rightmost forwarded hop", () => {
    expect(requestIp(new Request("http://x", { headers: { "x-real-ip": "1.1.1.1" } }))).toBe("1.1.1.1");
    expect(
      requestIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 2.2.2.2" } }))
    ).toBe("2.2.2.2");
    expect(requestIp(new Request("http://x"))).toBeNull();
  });
});
