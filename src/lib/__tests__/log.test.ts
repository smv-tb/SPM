import { describe, it, expect, vi, afterEach } from "vitest";
import { redactText, redactValue, describeError, safePath, maskEmail, logError, logRequestError } from "@/lib/log";

describe("redactText", () => {
  it("masks emails but keeps the domain for diagnosis", () => {
    expect(redactText("user jane.doe@example.com failed")).toBe("user j***@example.com failed");
    expect(maskEmail("nonsense")).toBe("[redacted]");
  });

  it("removes bearer tokens, JWTs, API tokens and key=value secrets", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";
    for (const secret of [jwt, "Bearer abcdef0123456789", "svp_abc123_deadbeefcafe", "password=hunter2hunter2", 'token: "abc123xyz"']) {
      const out = redactText(`context ${secret} tail`);
      expect(out).not.toMatch(/hunter2|abc123xyz|deadbeef|abcdef0123456789|eyJhbG/);
      expect(out).toContain("[redacted]");
    }
  });

  it("removes credentials from connection strings", () => {
    const out = redactText("could not reach postgresql://smartvie_app:s3cretPw@db.internal:5432/smartvie");
    expect(out).not.toContain("s3cretPw");
    expect(out).toContain("db.internal");
  });

  it("masks account and card numbers but not dates or short numbers", () => {
    expect(redactText("account 12345678 sort 20-00-00 12345678")).not.toMatch(/12345678/);
    expect(redactText("card 4111 1111 1111 1111")).not.toContain("4111 1111");
    expect(redactText("posted 2026-10-14 line 42 of 118")).toBe("posted 2026-10-14 line 42 of 118");
  });
});

describe("redactValue", () => {
  it("blanks sensitive keys at any depth and scrubs the strings that remain", () => {
    const out = redactValue({
      id: "abc",
      password: "x",
      nested: { accessToken: "y", sortCode: "20-00-00", note: "from a@b.co", list: [{ recoveryCode: "z" }] },
    }) as Record<string, any>;
    expect(out.id).toBe("abc");
    expect(out.password).toBe("[redacted]");
    expect(out.nested.accessToken).toBe("[redacted]");
    expect(out.nested.sortCode).toBe("[redacted]");
    expect(out.nested.note).toBe("from a***@b.co".replace("a***", "a***"));
    expect(out.nested.list[0].recoveryCode).toBe("[redacted]");
  });

  it("survives cycles and depth", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => JSON.stringify(redactValue(a))).not.toThrow();
  });
});

describe("describeError", () => {
  it("keeps only the reason from a Prisma error, never the arguments of the failed call", () => {
    const error = Object.assign(
      new Error(
        "\nInvalid `prisma.user.create()` invocation:\n\n{\n  data: {\n    email: \"jane@example.com\",\n    password: \"$2b$12$abcdefghijklmnopqrstuv\"\n  }\n}\n\nUnique constraint failed on the fields: (`email`)"
      ),
      { name: "PrismaClientKnownRequestError", code: "P2002", meta: { target: ["email"] } }
    );
    const s = describeError(error);
    const text = JSON.stringify(s);
    expect(s.code).toBe("P2002");
    expect(s.target).toEqual(["email"]);
    expect(text).not.toContain("jane@example.com");
    expect(text).not.toContain("$2b$12$");
    expect(s.message).toContain("Unique constraint failed");
  });

  it("scrubs ordinary messages, truncates long ones, and handles non-errors", () => {
    expect(describeError(new Error("bad token=abc12345 for x@y.io")).message).not.toMatch(/abc12345|x@y/);
    expect(describeError(new Error("a".repeat(5000))).message.length).toBeLessThan(700);
    expect(describeError({ password: "p", detail: "ok" }).message).not.toContain('"p"');
    expect(describeError("plain string").name).toBe("NonError");
  });
});

describe("safePath", () => {
  it("drops the query string and fragment", () => {
    expect(safePath("https://app.example.com/api/users?search=jane@example.com&token=abc#x")).toBe("/api/users");
    expect(safePath("/api/tasks?x=1")).toBe("/api/tasks");
    expect(safePath(undefined)).toBe("unknown");
  });
});

describe("log output", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a route error line carries the correlation id and path but no query, body or raw error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logRequestError("11111111-aaaa-bbbb-cccc-222222222222", { method: "POST", url: "https://x.test/api/users?email=a@b.co" }, new Error("boom password=hunter2hunter2"));
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("11111111-aaaa-bbbb-cccc-222222222222");
    expect(line).toContain("POST /api/users");
    expect(line).not.toMatch(/a@b\.co|hunter2|\?email/);
    expect(spy.mock.calls[0]).toHaveLength(1);
  });

  it("context is redacted by key", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("t", "failed", undefined, { userId: "u1", apiKey: "k", accountNumber: "12345678" });
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("u1");
    expect(line).not.toMatch(/"k"|12345678/);
  });
});
