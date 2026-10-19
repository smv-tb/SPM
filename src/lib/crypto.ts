import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Field-level encryption for secrets we must be able to read back (an
 * authenticator secret, later bank account numbers). Anything we only need to
 * *check* — passwords, recovery codes — is hashed instead, never encrypted.
 *
 * AES-256-GCM. A stored value looks like `v1.<keyId>.<iv>.<ciphertext>.<tag>`
 * (base64url parts), so it says which key made it and rotation never needs a
 * flag day: add a new key at the front of the ring, and old values keep
 * decrypting until they are re-saved (`needsReencryption` says which).
 *
 * Every value is bound to a context string (`user:<id>:totp`) as GCM
 * additional data, so a ciphertext copied into another row or column fails to
 * decrypt instead of quietly decrypting to someone else's secret.
 *
 * Keys come from `DATA_ENCRYPTION_KEYS`: `id:base64key` entries, comma
 * separated, **first is current**. Generate one with `openssl rand -base64 32`.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface Keyring {
  current: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
}

export class CryptoConfigError extends Error {}
export class DecryptionError extends Error {}

export function parseKeyring(value: string | undefined): Keyring {
  const entries = (value ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new CryptoConfigError("DATA_ENCRYPTION_KEYS is not set (format: id:base64key, first is current)");
  }
  const byId = new Map<string, Buffer>();
  let current: Keyring["current"] | undefined;
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const id = entry.slice(0, colon);
    const encoded = entry.slice(colon + 1);
    if (colon < 1 || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) {
      throw new CryptoConfigError(`Bad key id in DATA_ENCRYPTION_KEYS entry "${id || entry.slice(0, 4)}…"`);
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== KEY_BYTES) {
      throw new CryptoConfigError(`Key "${id}" must be ${KEY_BYTES} bytes of base64 (openssl rand -base64 32)`);
    }
    if (byId.has(id)) throw new CryptoConfigError(`Duplicate key id "${id}"`);
    byId.set(id, key);
    current ??= { id, key };
  }
  return { current: current!, byId };
}

let cached: { source: string | undefined; ring: Keyring } | undefined;
/** The keyring from the environment, parsed once per distinct value. */
export function defaultKeyring(): Keyring {
  const source = process.env.DATA_ENCRYPTION_KEYS;
  if (!cached || cached.source !== source) cached = { source, ring: parseKeyring(source) };
  return cached.ring;
}

export function encryptField(plaintext: string, context: string, ring: Keyring = defaultKeyring()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, ring.current.id, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptField(stored: string, context: string, ring: Keyring = defaultKeyring()): string {
  const [version, keyId, iv, ciphertext, tag, ...extra] = stored.split(".");
  if (version !== VERSION || !keyId || !iv || ciphertext === undefined || !tag || extra.length > 0) {
    throw new DecryptionError("Unrecognised encrypted value");
  }
  const key = ring.byId.get(keyId);
  if (!key) throw new DecryptionError(`No key "${keyId}" in the keyring (was it removed too early?)`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong context or tampering all look the same on purpose.
    throw new DecryptionError("Could not decrypt the value");
  }
}

/** True when a stored value was made with an older key than the current one. */
export function needsReencryption(stored: string, ring: Keyring = defaultKeyring()): boolean {
  return stored.split(".")[1] !== ring.current.id;
}

/**
 * A blind index lets the database enforce "no duplicates" (or look a row up) on a
 * value it cannot read: an HMAC of the value under a key derived from a ring key,
 * stored as `<keyId>:<hex>`. The derived key is separate from the encryption key
 * and bound to `context` (what the index is *for*), so one index can't be replayed
 * as another.
 *
 * It is a keyed hash, not a plain one — an 8-digit account number has only 10^8
 * possibilities, so an unkeyed hash would just be the number again.
 *
 * Rotation: an index made under an old key stays valid; `blindIndexes` returns the
 * index under *every* key in the ring, so a lookup finds a row whichever key made it.
 */
function indexKey(key: Buffer, context: string): Buffer {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), `blind-index:${context}`, KEY_BYTES));
}

const indexUnder = (keyId: string, key: Buffer, value: string, context: string) =>
  `${keyId}:${createHmac("sha256", indexKey(key, context)).update(value, "utf8").digest("hex")}`;

/** The index to store: under the current key. */
export function blindIndex(value: string, context: string, ring: Keyring = defaultKeyring()): string {
  return indexUnder(ring.current.id, ring.current.key, value, context);
}

/** The index under every key in the ring, for finding a row made under any of them. */
export function blindIndexes(value: string, context: string, ring: Keyring = defaultKeyring()): string[] {
  return [...ring.byId].map(([id, key]) => indexUnder(id, key, value, context));
}
