/**
 * Credentials system — encrypted storage for secrets (API keys, passwords, tokens).
 *
 * Design principles:
 * - Secrets NEVER appear in workflow JSON. Workflows reference credentials by ID.
 * - Storage at rest: AES-256-GCM with random IV per credential, authenticated.
 * - Master key from OPENCLAW_ENCRYPTION_KEY env var (with first-run fallback to a
 *   generated key file in the workflow dir).
 * - Plain-text values are only materialized at execution time, scoped to a single
 *   ExecutionContext, and never logged or persisted in execution records.
 *
 * Threat model:
 * - DB / disk leak: encrypted blobs are useless without the master key.
 * - Process memory: not protected (out of scope for a JS runtime).
 * - Master key leak: equivalent to a full credential leak — operator must protect it.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A credential definition stored on disk. The `data` field is encrypted. */
export interface CredentialRecord {
  id: string;
  /** Credential type identifier — e.g. "openai-api-key", "http-basic-auth". */
  type: string;
  /** Human-readable name shown in UI. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Encrypted credential payload (base64 of iv + authTag + ciphertext). */
  encryptedData: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

/** A reference to a stored credential, embedded in workflow node config. */
export interface CredentialRef {
  /** Sentinel marker — used by expression resolver to detect credential refs. */
  __credentialRef: true;
  credentialId: string;
  /** Optional path inside the credential payload (e.g. "apiKey" for { apiKey: "...", baseUrl: "..." }). */
  field?: string;
}

/** Type guard — duck-type detect a CredentialRef in arbitrary config values. */
export function isCredentialRef(value: unknown): value is CredentialRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__credentialRef === true &&
    typeof (value as CredentialRef).credentialId === "string"
  );
}

/** Build a reference object that can be embedded in workflow config. */
export function makeCredentialRef(credentialId: string, field?: string): CredentialRef {
  const ref: CredentialRef = { __credentialRef: true, credentialId };
  if (field) ref.field = field;
  return ref;
}

// ─── Encryption ─────────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm" as const;
const KEY_LEN = 32;          // 256 bits
const IV_LEN = 12;           // 96 bits — recommended for GCM
const AUTH_TAG_LEN = 16;     // 128 bits
const SCRYPT_SALT = "openclaw-workflow-credential-v1"; // App-specific salt
const MIN_PASSPHRASE_LENGTH = 16;

/**
 * Derive a 256-bit AES key from the user-supplied master key string.
 * scrypt is intentionally slow to make brute-force harder.
 */
function deriveKey(passphrase: string): Buffer {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new CredentialError(
      `Master encryption key must be at least ${MIN_PASSPHRASE_LENGTH} characters long`
    );
  }
  return scryptSync(passphrase, SCRYPT_SALT, KEY_LEN);
}

/**
 * Encrypt a JSON-serializable payload. Returns base64(IV || authTag || ciphertext).
 */
export function encryptPayload(payload: unknown, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);

  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: [IV (12B)] [authTag (16B)] [ciphertext]
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypt a base64 blob created by encryptPayload. Throws on tampered/wrong key.
 */
export function decryptPayload<T = unknown>(encrypted: string, masterKey: string): T {
  const key = deriveKey(masterKey);
  const buf = Buffer.from(encrypted, "base64");

  if (buf.length < IV_LEN + AUTH_TAG_LEN) {
    throw new CredentialError("Encrypted blob is malformed (too short)");
  }

  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + AUTH_TAG_LEN);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new CredentialError(
      "Failed to decrypt credential — wrong master key, or data has been tampered with"
    );
  }

  try {
    return JSON.parse(plaintext.toString("utf-8")) as T;
  } catch {
    throw new CredentialError("Decrypted credential is not valid JSON");
  }
}

// ─── Store interface ────────────────────────────────────────────────────────

/** Credential payload as seen by modules — already decrypted. */
export type CredentialPayload = Record<string, unknown>;

/** Public credential summary (no secrets) for UI listings. */
export interface CredentialSummary {
  id: string;
  type: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * CredentialStore is the interface modules use at runtime via ExecutionContext.
 * It must NOT expose plaintext to anything that could persist it (logs, traces).
 */
export interface CredentialStore {
  /** Resolve a credential reference to its decrypted payload. */
  resolve(ref: CredentialRef): Promise<CredentialPayload>;

  /** List public summaries (no secrets) for UI. */
  list(): Promise<CredentialSummary[]>;

  /** Get a public summary by ID. */
  get(id: string): Promise<CredentialSummary | null>;

  /** Create a new credential. Returns the public summary. */
  create(input: { type: string; name: string; description?: string; data: CredentialPayload }): Promise<CredentialSummary>;

  /** Update fields. If `data` is provided, the existing payload is replaced. */
  update(id: string, input: Partial<{ name: string; description: string; data: CredentialPayload }>): Promise<CredentialSummary>;

  /** Delete a credential. Returns true if deleted, false if not found. */
  delete(id: string): Promise<boolean>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

// ─── Convenience: equality check (for tests / migration) ────────────────────

/** Constant-time string comparison for sensitive values. */
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
