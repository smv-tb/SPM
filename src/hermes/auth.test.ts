import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyToken, withHermesAuth, extractBearerToken } from "./auth";

describe("Hermes auth", () => {
  const ORIGINAL_TOKEN = process.env.HERMES_API_TOKEN;

  beforeEach(() => {
    process.env.HERMES_API_TOKEN = "test-token";
  });

  afterEach(() => {
    process.env.HERMES_API_TOKEN = ORIGINAL_TOKEN;
  });

  describe("verifyToken", () => {
    it("accepts the configured token", () => {
      expect(verifyToken("test-token")).toBe(true);
    });

    it("rejects a wrong token", () => {
      expect(verifyToken("wrong-token")).toBe(false);
    });

    it("rejects a missing token", () => {
      expect(verifyToken(undefined)).toBe(false);
      expect(verifyToken(null)).toBe(false);
    });

    it("rejects everything when HERMES_API_TOKEN is unset", () => {
      delete process.env.HERMES_API_TOKEN;
      expect(verifyToken("test-token")).toBe(false);
    });
  });

  describe("withHermesAuth", () => {
    it("returns ok for a valid token", () => {
      expect(withHermesAuth("test-token")).toEqual({ ok: true });
    });

    it("returns an error for an invalid token", () => {
      const result = withHermesAuth("nope");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Unauthorized/);
      }
    });
  });

  describe("extractBearerToken", () => {
    it("extracts the token from a well-formed header", () => {
      const req = new Request("http://localhost/api/hermes", {
        headers: { Authorization: "Bearer abc123" },
      });
      expect(extractBearerToken(req)).toBe("abc123");
    });

    it("is case-insensitive on the Bearer scheme", () => {
      const req = new Request("http://localhost/api/hermes", {
        headers: { Authorization: "bearer abc123" },
      });
      expect(extractBearerToken(req)).toBe("abc123");
    });

    it("returns null when the header is missing", () => {
      const req = new Request("http://localhost/api/hermes");
      expect(extractBearerToken(req)).toBeNull();
    });

    it("returns null for a non-Bearer scheme", () => {
      const req = new Request("http://localhost/api/hermes", {
        headers: { Authorization: "Basic abc123" },
      });
      expect(extractBearerToken(req)).toBeNull();
    });
  });
});
