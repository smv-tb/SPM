import { describe, it, expect } from "vitest";
import { httpUrl } from "../_helpers";
import { fundingSchema } from "../funding";
import { projectUpdateSchema } from "../project";
import { userSchema } from "../user";

describe("httpUrl", () => {
  it.each(["https://funder.example.org/call", "http://example.com", "HTTPS://EXAMPLE.COM/x"])(
    "accepts %s",
    (value) => expect(httpUrl.safeParse(value).success).toBe(true)
  );

  it.each([
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com",
  ])("refuses %s", (value) => expect(httpUrl.safeParse(value).success).toBe(false));
});

describe("URL fields use httpUrl", () => {
  const evil = "javascript:alert(1)";

  it("funding funderUrl", () => {
    const base = {
      fundId: "F1", fundName: "Grant", type: "GRANT", section: "PIPELINE", source: "Funder",
      amount: 1000, projectId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
    };
    expect(fundingSchema.safeParse({ ...base, funderUrl: "https://funder.example.org" }).success).toBe(true);
    expect(fundingSchema.safeParse({ ...base, funderUrl: evil }).success).toBe(false);
  });

  it("project logoUrl", () => {
    const id = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(projectUpdateSchema.safeParse({ id, logoUrl: evil }).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ id, logoUrl: "https://cdn.example.com/logo.png" }).success).toBe(true);
  });

  it("user avatarUrl", () => {
    const user = { email: "a@example.com", name: "A" };
    expect(userSchema.safeParse({ ...user, avatarUrl: evil }).success).toBe(false);
  });
});
