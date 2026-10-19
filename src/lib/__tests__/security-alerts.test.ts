import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  alertInBackground, becameAdmin, buildPayload, isNewSignInAddress, notifySecurityEvent, signBody, SIGNATURE_HEADER,
} from "@/lib/security-alerts";

const alert = { event: "mfa.reset", summary: "Two-factor was switched off for a@example.com", target: "a@example.com" } as const;

describe("buildPayload", () => {
  it("adds source, severity and time, and keeps what the caller gave", () => {
    const p = buildPayload(alert, new Date("2026-10-02T09:00:00Z"));
    expect(p).toMatchObject({ source: "smartvie-pm", severity: "critical", occurredAt: "2026-10-02T09:00:00.000Z", target: "a@example.com" });
  });
});

describe("signBody", () => {
  it("is a stable HMAC that changes with the body and the secret", () => {
    const sig = signBody("{}", "s1");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody("{}", "s1")).toBe(sig);
    expect(signBody("{ }", "s1")).not.toBe(sig);
    expect(signBody("{}", "s2")).not.toBe(sig);
  });
});

describe("notifySecurityEvent", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    delete process.env.SECURITY_ALERT_WEBHOOK_URL;
    delete process.env.SECURITY_ALERT_WEBHOOK_SECRET;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends nothing, and says so, when no webhook is configured", async () => {
    await notifySecurityEvent(alert);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("posts the payload, signed when a secret is set", async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = "http://n8n.local/webhook/x";
    process.env.SECURITY_ALERT_WEBHOOK_SECRET = "shh";
    await notifySecurityEvent(alert);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://n8n.local/webhook/x");
    expect(init.headers[SIGNATURE_HEADER]).toBe(signBody(init.body, "shh"));
    expect(JSON.parse(init.body).event).toBe("mfa.reset");
  });

  it("leaves the signature off when there is no secret", async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = "http://n8n.local/webhook/x";
    await notifySecurityEvent(alert);
    expect(fetchMock.mock.calls[0][1].headers[SIGNATURE_HEADER]).toBeUndefined();
  });

  it("never throws when the webhook is down or refuses", async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = "http://n8n.local/webhook/x";
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(notifySecurityEvent(alert)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(notifySecurityEvent(alert)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("alertInBackground returns at once", () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = "http://n8n.local/webhook/x";
    fetchMock.mockReturnValue(new Promise(() => {}));
    expect(alertInBackground(alert)).toBeUndefined();
  });
});

describe("becameAdmin", () => {
  it("is true for a new admin or a promotion, not for an existing admin or other roles", () => {
    expect(becameAdmin(null, "ADMIN")).toBe(true);
    expect(becameAdmin("PM", "ADMIN")).toBe(true);
    expect(becameAdmin("ADMIN", "ADMIN")).toBe(false);
    expect(becameAdmin("ADMIN", "PM")).toBe(false);
    expect(becameAdmin(null, "PM")).toBe(false);
  });
});

describe("isNewSignInAddress", () => {
  const dbWith = (any: number, here: number) =>
    ({ auditLog: { count: vi.fn().mockResolvedValueOnce(any).mockResolvedValueOnce(here) } }) as never;

  it("is new only when there is history and none from this address", async () => {
    expect(await isNewSignInAddress(dbWith(3, 0), "u1", "203.0.113.9")).toBe(true);
    expect(await isNewSignInAddress(dbWith(3, 1), "u1", "203.0.113.9")).toBe(false);
  });
  it("is not new on a first ever sign-in, or when the address is unknown", async () => {
    expect(await isNewSignInAddress(dbWith(0, 0), "u1", "203.0.113.9")).toBe(false);
    expect(await isNewSignInAddress(dbWith(3, 0), "u1", null)).toBe(false);
  });
});
