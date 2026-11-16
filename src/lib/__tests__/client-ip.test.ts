import { describe, it, expect } from "vitest";
import { clientIp, wrapperStartupProblem, WRAPPER_MARKER_HEADER } from "@/lib/client-ip";

const TOKEN = "per-boot-token-0123456789abcdefghijklmnop";
const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp (F-10: trust X-Real-IP only from the wrapper)", () => {
  const prod = { token: TOKEN, nodeEnv: "production" };

  it("trusts X-Real-IP when the wrapper's marker is present", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.7", [WRAPPER_MARKER_HEADER]: TOKEN }), prod)).toBe("203.0.113.7");
  });

  it("does not trust X-Real-IP when the marker is absent", () => {
    expect(clientIp(h({ "x-real-ip": "1.2.3.4" }), prod)).toBeNull();
  });

  it("does not trust X-Real-IP with a wrong or truncated marker", () => {
    expect(clientIp(h({ "x-real-ip": "1.2.3.4", [WRAPPER_MARKER_HEADER]: "guess" }), prod)).toBeNull();
    expect(clientIp(h({ "x-real-ip": "1.2.3.4", [WRAPPER_MARKER_HEADER]: TOKEN.slice(0, -1) + "X" }), prod)).toBeNull();
  });

  it("never falls back to X-Forwarded-For when the wrapper is configured", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), prod)).toBeNull();
  });

  it("trusts nothing in production without the wrapper", () => {
    expect(clientIp(h({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }), { nodeEnv: "production" })).toBeNull();
  });

  it("keeps the best guess in development without the wrapper", () => {
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 5.6.7.8" }), { nodeEnv: "development" })).toBe("5.6.7.8");
  });
});

describe("wrapperStartupProblem", () => {
  it("refuses production without the wrapper", () => {
    expect(wrapperStartupProblem({ nodeEnv: "production" })?.level).toBe("refuse");
  });
  it("warns in development without it", () => {
    expect(wrapperStartupProblem({ nodeEnv: "development" })?.level).toBe("warn");
  });
  it("is quiet behind the wrapper", () => {
    expect(wrapperStartupProblem({ token: TOKEN, nodeEnv: "production" })).toBeNull();
  });
});
