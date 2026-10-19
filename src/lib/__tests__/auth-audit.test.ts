import { describe, it, expect, vi } from "vitest";
import { auditAuthEvent, requestFacts } from "@/lib/auth-audit";

const user = { id: "u1", email: "a@example.com" };
const facts = { ipAddress: "203.0.113.9", userAgent: "TestBrowser/1.0" };
const fakeDb = () => {
  const create = vi.fn().mockResolvedValue({});
  return { db: { auditLog: { create } } as never, create };
};

describe("requestFacts", () => {
  it("takes the client IP and user agent from the headers", () => {
    const f = requestFacts(new Headers({ "x-real-ip": "198.51.100.4", "user-agent": "Mozilla/5.0" }));
    expect(f).toEqual({ ipAddress: "198.51.100.4", userAgent: "Mozilla/5.0" });
  });

  it("copes with neither", () => {
    expect(requestFacts(new Headers())).toEqual({ ipAddress: null, userAgent: null });
  });

  it("truncates a huge user agent so a client can't bloat the log", () => {
    expect(requestFacts(new Headers({ "user-agent": "x".repeat(5000) })).userAgent).toHaveLength(200);
  });
});

describe("auditAuthEvent", () => {
  it("records a sign-in as the user's own act", async () => {
    const { db, create } = fakeDb();
    await auditAuthEvent(db, "auth.login", user, facts, { method: "password" });
    const row = create.mock.calls[0][0].data;
    expect(row).toMatchObject({ action: "auth.login", entityType: "User", entityId: "u1", actorType: "USER", actorId: "u1", ipAddress: "203.0.113.9" });
    expect(row.after).toEqual({ method: "password", userAgent: "TestBrowser/1.0" });
  });

  it("records a failure as something that happened to the account, not by it", async () => {
    const { db, create } = fakeDb();
    await auditAuthEvent(db, "auth.login_failed", user, facts, { reason: "wrong_password" });
    const row = create.mock.calls[0][0].data;
    expect(row.actorType).toBe("SYSTEM");
    expect(row.actorId).toBeNull();
    expect(row.entityId).toBe("u1");
  });

  it("never lets a failed audit write break the sign-in", async () => {
    const db = { auditLog: { create: vi.fn().mockRejectedValue(new Error("db down")) } } as never;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(auditAuthEvent(db, "auth.login", user, facts)).resolves.toBeUndefined();
  });

  it("omits the user agent when there isn't one", async () => {
    const { db, create } = fakeDb();
    await auditAuthEvent(db, "auth.login", user, { ipAddress: null, userAgent: null }, { method: "password" });
    expect(create.mock.calls[0][0].data.after).toEqual({ method: "password" });
  });
});
