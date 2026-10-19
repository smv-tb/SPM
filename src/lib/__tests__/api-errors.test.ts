import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { withErrorHandler } from "@/lib/api-errors";

const failing = (error: unknown) =>
  withErrorHandler(async () => {
    throw error;
  });

const request = () => new Request("https://project.example.com/api/thing", { method: "POST" });

describe("withErrorHandler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("never sends the error's text to the client in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await failing(new Error('relation "secret_table" does not exist'))(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret_table");
  });

  it("returns the id it logged the failure under", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await failing(new Error("boom"))(request());
    const body = await res.json();

    expect(body.errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("X-Error-Id")).toBe(body.errorId);
    expect(String(log.mock.calls[0][0])).toContain(body.errorId);
  });

  it("keeps the error's text outside production for debugging", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await failing(new Error("boom"))(request());
    const body = await res.json();

    expect(body.details).toEqual({ debugMessage: "boom" });
    expect(body.errorId).toBeDefined();
  });

  it("reports a pending migration as 503 with an id", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await failing(Object.assign(new Error("The column `x` does not exist"), { code: "P2022" }))(request());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.errorId).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("`x`");
  });
});
