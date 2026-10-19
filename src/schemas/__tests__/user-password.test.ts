import { describe, it, expect } from "vitest";
import { userCreateSchema, userUpdateSchema, firstPasswordMessage } from "../user";

const create = (password: string, extra: object = {}) =>
  userCreateSchema.safeParse({ name: "Jane Doe", email: "jane.doe@example.com", password, ...extra });

describe("userCreateSchema password", () => {
  it("accepts a strong password", () => {
    expect(create("horse-staple-lamp-cloud-seven").success).toBe(true);
  });

  it("refuses the old 8-character minimum", () => {
    expect(create("Abcd1234").success).toBe(false);
  });

  it("refuses a decorated common word", () => {
    const result = create("Password123456!");
    expect(result.success).toBe(false);
    if (!result.success) expect(firstPasswordMessage(result.error)).toMatch(/common word/);
  });

  it("refuses a password built from the user's own name, using the other fields", () => {
    const result = create("jane-was-here-2026-ok");
    expect(result.success).toBe(false);
    if (!result.success) expect(firstPasswordMessage(result.error)).toMatch(/name or email/);
  });

  it("reports each problem once", () => {
    const result = create("Sh0rt");
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.filter((i) => i.path[0] === "password").map((i) => i.message);
      expect(new Set(messages).size).toBe(messages.length);
    }
  });
});

describe("userUpdateSchema password", () => {
  it("lets a PATCH leave the password out or blank", () => {
    expect(userUpdateSchema.safeParse({ name: "New Name" }).success).toBe(true);
    expect(userUpdateSchema.safeParse({ password: "" }).success).toBe(true);
  });

  it("applies the same rules when a password is given", () => {
    expect(userUpdateSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(userUpdateSchema.safeParse({ password: "Password123456!" }).success).toBe(false);
    expect(userUpdateSchema.safeParse({ password: "horse-staple-lamp-cloud-seven" }).success).toBe(true);
  });
});
