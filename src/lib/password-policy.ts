/**
 * Password rules. Dependency-free so the Zod schemas, the Hermes tools and the
 * user form all enforce the same thing and show the same message.
 *
 * Length does most of the work (12+). The remaining rules target what people
 * do to reach 12 characters without choosing anything: decorating a common
 * word ("Password123456!"), running along the keyboard or alphabet, repeating
 * a pattern, or building it from their own name or email.
 */
export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt ignores everything after byte 72, so a longer password would not be what it looks like. */
export const PASSWORD_MAX_BYTES = 72;
const MIN_DISTINCT_CHARACTERS = 6;

/** Common passwords' letters, once digits and symbols are stripped. */
const COMMON_WORDS = new Set([
  "password", "passwort", "passwrd", "letmein", "welcome", "admin", "administrator", "changeme",
  "qwerty", "qwertyuiop", "asdfghjkl", "zxcvbnm", "azerty", "iloveyou", "monkey", "dragon",
  "football", "baseball", "basketball", "master", "shadow", "sunshine", "princess", "superman",
  "batman", "trustno", "secret", "login", "abc", "abcdef", "test", "testing", "guest", "default",
  "summer", "winter", "spring", "autumn", "london", "manchester", "liverpool", "arsenal", "chelsea",
  "starwars", "pokemon", "whatever", "freedom", "michael", "jennifer", "jordan", "harley", "ranger",
  "smartvie", "smartviepm", "ecosystem", "projectmanagement", "livinglab", "company", "finance",
]);

/** Contiguous runs people type: digits, alphabet and keyboard rows, both directions. */
const RUNS = (() => {
  const base = [
    "012345678901234567890123456789",
    "abcdefghijklmnopqrstuvwxyz",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
    "qwertyuiopasdfghjklzxcvbnm",
  ];
  return [...base, ...base.map((s) => [...s].reverse().join(""))];
})();

const LEET: Record<string, string> = { "@": "a", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "$": "s", "!": "i" };

const lettersOnly = (value: string) => value.replace(/[^a-z]/g, "");
const leet = (value: string) => value.replace(/[@013457$!]/g, (c) => LEET[c] ?? c);

function isCommonOrRepeated(letters: string): boolean {
  if (letters === "") return false;
  if (COMMON_WORDS.has(letters)) return true;
  for (const word of COMMON_WORDS) {
    if (letters.length > word.length && letters.length % word.length === 0 && word.repeat(letters.length / word.length) === letters) {
      return true;
    }
  }
  return false;
}

/**
 * A common word once the usual dressing is taken off: digits and symbols
 * around it ("Welcome2026!!!!"), letters swapped for look-alikes ("p@ssw0rd"),
 * or the word repeated ("passwordpassword").
 */
function isDecoratedCommonWord(lower: string): boolean {
  const withoutTrailing = lower.replace(/[^a-z]+$/, "");
  return [lower, withoutTrailing].some((candidate) =>
    [lettersOnly(candidate), lettersOnly(leet(candidate))].some(isCommonOrRepeated)
  );
}

export interface PasswordContext {
  email?: string | null;
  name?: string | null;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Whole-word tokens of the user's own details that must not appear in the password. */
function personalTokens(context: PasswordContext): string[] {
  const tokens: string[] = [];
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local) tokens.push(local, ...local.split(/[^a-z0-9]+/));
  if (context.name) tokens.push(...context.name.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  return [...new Set(tokens.filter((t) => t.length >= 4))];
}

/** Why a password is not acceptable. Empty means it is. Messages are shown to the user. */
export function passwordIssues(password: string, context: PasswordContext = {}): string[] {
  const issues: string[] = [];
  const length = [...password].length;

  if (length < PASSWORD_MIN_LENGTH) {
    issues.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (utf8Bytes(password) > PASSWORD_MAX_BYTES) {
    issues.push(`Password is too long (at most ${PASSWORD_MAX_BYTES} bytes — about ${PASSWORD_MAX_BYTES} characters)`);
  }
  // The content rules below only mean anything for something long enough to pass the first.
  if (issues.length > 0) return issues;

  const lower = password.toLowerCase();
  const alnum = lower.replace(/[^\p{L}\p{N}]/gu, "");

  if (new Set(password).size < MIN_DISTINCT_CHARACTERS) {
    issues.push("Password repeats too few different characters");
  }

  if (isDecoratedCommonWord(lower)) {
    issues.push("Password is a common word with numbers or symbols added — choose something less guessable");
  }

  if (alnum.length >= PASSWORD_MIN_LENGTH && RUNS.some((run) => run.includes(alnum))) {
    issues.push("Password is a keyboard, number or alphabet sequence");
  }

  if (personalTokens(context).some((token) => lower.includes(token))) {
    issues.push("Password must not contain your name or email");
  }

  return issues;
}
