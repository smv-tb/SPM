import { describe, it, expect } from "vitest";
import { normaliseIp, parseTrustedProxies, resolveClientIp } from "../../../trusted-proxy.mjs";

const PROXY = "192.168.1.20";
const trusted = parseTrustedProxies(` ${PROXY} , 10.0.0.5 `);

describe("resolveClientIp", () => {
  it("uses the TCP peer when it is not a trusted proxy, ignoring any header", () => {
    expect(resolveClientIp("203.0.113.9", "1.2.3.4", trusted)).toBe("203.0.113.9");
  });

  it("cannot be steered by a spoofed X-Forwarded-For sent straight to the app", () => {
    expect(resolveClientIp("192.168.1.77", "8.8.8.8, 9.9.9.9", trusted)).toBe("192.168.1.77");
  });

  it("takes the hop the proxy appended, not what the client prepended", () => {
    expect(resolveClientIp(PROXY, "6.6.6.6, 198.51.100.4", trusted)).toBe("198.51.100.4");
  });

  it("skips chained trusted proxies from the right", () => {
    expect(resolveClientIp(PROXY, "6.6.6.6, 198.51.100.4, 10.0.0.5", trusted)).toBe("198.51.100.4");
  });

  it("handles repeated X-Forwarded-For headers", () => {
    expect(resolveClientIp(PROXY, ["6.6.6.6", "198.51.100.4"], trusted)).toBe("198.51.100.4");
  });

  it("falls back to the proxy when it forwards no header", () => {
    expect(resolveClientIp(PROXY, undefined, trusted)).toBe(PROXY);
  });

  it("matches IPv4-mapped IPv6 peers", () => {
    expect(resolveClientIp(`::ffff:${PROXY}`, "198.51.100.4", trusted)).toBe("198.51.100.4");
  });

  it("trusts nothing when no proxies are configured", () => {
    expect(resolveClientIp(PROXY, "198.51.100.4", parseTrustedProxies(undefined))).toBe(PROXY);
  });
});

describe("normaliseIp", () => {
  it("leaves real IPv6 addresses alone", () => {
    expect(normaliseIp("::1")).toBe("::1");
    expect(normaliseIp("2001:db8::1")).toBe("2001:db8::1");
  });
});
