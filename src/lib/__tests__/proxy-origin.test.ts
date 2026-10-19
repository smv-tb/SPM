import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * Regression cover for the CSRF origin check in src/proxy.ts.
 *
 * The original check compared the request's Origin against NEXTAUTH_URL
 * including the scheme. Behind a TLS-terminating reverse proxy — the normal
 * production setup — NEXTAUTH_URL was http:// while the browser was on
 * https://, so every client-side GET to /api/* got a 403 and most callers
 * swallowed it. These tests pin the same-origin behaviour that fixes it.
 */

const ORIGINAL_URL = process.env.NEXTAUTH_URL;

function get(path: string, headers: Record<string, string>) {
  return new NextRequest(`https://project.example.com${path}`, { method: "GET", headers });
}

describe("proxy origin check", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_URL = "http://project.example.com";
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = ORIGINAL_URL;
  });

  it("allows an https request when NEXTAUTH_URL is http on the same host", () => {
    // The exact production failure: scheme differs, host does not.
    const res = proxy(
      get("/api/funding/analytics", {
        referer: "https://project.example.com/funding",
        host: "project.example.com",
      })
    );
    expect(res.status).toBe(200);
  });

  it("allows the same host reported via x-forwarded-host", () => {
    const res = proxy(
      get("/api/funding/analytics", {
        origin: "https://project.example.com",
        host: "localhost:9637",
        "x-forwarded-host": "project.example.com",
      })
    );
    expect(res.status).toBe(200);
  });

  it("still blocks a genuinely foreign origin", () => {
    const res = proxy(
      get("/api/funding/analytics", {
        origin: "https://evil.example.net",
        host: "project.example.com",
      })
    );
    expect(res.status).toBe(403);
  });

  it("allows an origin that matches NEXTAUTH_URL exactly", () => {
    const res = proxy(
      get("/api/funding/analytics", {
        origin: "http://project.example.com",
        host: "somewhere-else.internal",
      })
    );
    expect(res.status).toBe(200);
  });

  it("allows a request with no Origin or Referer at all", () => {
    // Direct navigation, curl, server-to-server — not a CSRF vector.
    const res = proxy(get("/api/funding/analytics", { host: "project.example.com" }));
    expect(res.status).toBe(200);
  });

  it("rejects a malformed Origin header with 400", () => {
    const res = proxy(
      get("/api/funding/analytics", { origin: "not a url", host: "project.example.com" })
    );
    expect(res.status).toBe(400);
  });

  it("does not let a malformed NEXTAUTH_URL take the API down", () => {
    process.env.NEXTAUTH_URL = "://broken";
    const res = proxy(
      get("/api/funding/analytics", {
        origin: "https://project.example.com",
        host: "project.example.com",
      })
    );
    expect(res.status).toBe(200);
  });

  it("keeps requiring X-Requested-By on mutations", () => {
    const req = new NextRequest("https://project.example.com/api/funding", {
      method: "POST",
      headers: { origin: "https://project.example.com", host: "project.example.com" },
    });
    expect(proxy(req).status).toBe(403);
  });

  it("lets a mutation through when X-Requested-By is present", () => {
    const req = new NextRequest("https://project.example.com/api/funding", {
      method: "POST",
      headers: {
        origin: "https://project.example.com",
        host: "project.example.com",
        "X-Requested-By": "smartvie-pm",
      },
    });
    expect(proxy(req).status).toBe(200);
  });
});
