import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";
import { proxy } from "@/proxy";

describe("buildCsp", () => {
  it("allows scripts only by nonce in production", () => {
    const csp = buildCsp("abc123");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("report-uri /api/csp-report");
  });

  it("adds unsafe-eval only for the dev server", () => {
    expect(buildCsp("n", { dev: true })).toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(buildCsp("n")).not.toContain("unsafe-eval");
  });

  it("mints a fresh, unguessable nonce each time", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("proxy CSP", () => {
  it("puts a nonce policy on page responses and forwards it to the app", () => {
    const res = proxy(new NextRequest("https://project.example.com/funding"));
    const csp = res.headers.get("Content-Security-Policy-Report-Only")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("does not touch API responses", () => {
    const res = proxy(new NextRequest("https://project.example.com/api/health"));
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("lets the browser post a violation report without the CSRF header", () => {
    const res = proxy(
      new NextRequest("https://project.example.com/api/csp-report", { method: "POST" })
    );
    expect(res.status).toBe(200);
  });
});
