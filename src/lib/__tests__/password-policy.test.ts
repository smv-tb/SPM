import { describe, it, expect } from "vitest";
import { passwordIssues, PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES } from "@/lib/password-policy";

const ok = (password: string, context = {}) => expect(passwordIssues(password, context)).toEqual([]);
const bad = (password: string, context = {}) => expect(passwordIssues(password, context).length).toBeGreaterThan(0);

describe("length", () => {
  it(`requires at least ${PASSWORD_MIN_LENGTH} characters`, () => {
    bad("Sh0rt!pw");
    bad("elevenchars"); // 11
    ok("twelve chars"); // 12
  });

  it("counts characters, not UTF-16 units", () => {
    // 6 emoji = 6 characters (12 UTF-16 units): still too short
    bad("😀😁😂🤣😃😄");
  });

  it(`refuses more than ${PASSWORD_MAX_BYTES} bytes, which bcrypt would silently cut off`, () => {
    ok("correct horse battery staple, with a few more words in it");
    bad("x1".repeat(40)); // 80 bytes
    expect(passwordIssues("é".repeat(40))[0]).toMatch(/too long/); // 40 chars but 80 bytes
  });

  it("reports length alone for a short password rather than a pile of other complaints", () => {
    expect(passwordIssues("aaa")).toHaveLength(1);
  });
});

describe("common words with decoration", () => {
  it.each([
    "Password123456!",
    "p@ssw0rd12345",
    "Welcome2026!!!!",
    "Qwerty-123456-!",
    "Smartvie2027!!",
    "passwordpassword",
    "LetMeIn!!!!!!1",
  ])("refuses %s", (pw) => bad(pw));

  it("does not refuse a phrase that merely contains a common word", () => {
    ok("my password is a long boring sentence");
    ok("correct-horse-battery-staple");
  });
});

describe("repeats and sequences", () => {
  it.each(["aaaaaaaaaaaa", "121212121212", "abababababab", "111111111111"])("refuses %s", (pw) => bad(pw));

  it.each(["123456789012", "abcdefghijkl", "1234567890123", "zyxwvutsrqpo", "0987654321098"])(
    "refuses the run %s",
    (pw) => bad(pw)
  );

  it("allows a long password that happens to contain a run", () => {
    ok("abcdefg then something else entirely");
  });
});

describe("personal details", () => {
  const context = { email: "jane.doe@example.com", name: "Jane Doe" };

  it("refuses the email local part or any part of the name", () => {
    bad("xx-jane.doe-xx-1", context);
    bad("my name is Jane!!!", context);
    bad("JANE then other words", context);
  });

  it("ignores name fragments under four letters, so short surnames don't block ordinary words", () => {
    ok("see you later doe 99 times", context);
    ok("Al is a long walk home", { name: "Al Bo", email: "ab@example.com" });
  });

  it("only applies when context is given", () => {
    ok("jane.doe plus other words");
  });
});

describe("a good password", () => {
  it.each([
    "horse-staple-lamp-cloud-seven",
    "T9#mq!Vz2$kPw8@d",
    "four score and seven years ago",
  ])("accepts %s", (pw) => ok(pw));
});
