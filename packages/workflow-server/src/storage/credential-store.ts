/**
 * File-based encrypted credential store.
 *
 * Storage layout:
 *   {workflowDir}/.credentials/
 *     master.key           — generated on first run if env var unset; chmod 600
 *     {credId}.json        — { id, type, name, encryptedData, ... }
 *
 * Master key precedence:
 *   1. process.env.OPENCLAW_ENCRYPTION_KEY
 *   2. Generated random 256-bit key persisted to master.key
 *
 * Once a master key is set, it MUST NOT change. Rotating the key requires
 * re-encrypting every credential (not implemented in v1; documented as ops task).
 */

import { mkdir, readFile, writeFile, readdir, unlink, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import {
  encryptPayload,
  decryptPayload,
  CredentialError,
  type CredentialPayload,
  type CredentialRecord,
  type CredentialRef,
  type CredentialStore,
  type CredentialSummary,
} from "@openclaw/workflow-engine";

const CRED_DIR_NAME = ".credentials";
const MASTER_KEY_FILE = "master.key";
const ENV_VAR = "OPENCLAW_ENCRYPTION_KEY";

export interface FileCredentialStoreOptions {
  /** Where credential files are stored. Default: {workflowDir}/.credentials */
  dir: string;
  /** Override master key (otherwise read from env or master.key file). */
  masterKey?: string;
}

export class FileCredentialStore implements CredentialStore {
  private readonly dir: string;
  private masterKey: string | null;
  private masterKeyOverride: string | undefined;
  /** In-process cache of decrypted payloads. Cleared by clearCache() and on update/delete. */
  private decryptCache = new Map<string, CredentialPayload>();

  constructor(opts: FileCredentialStoreOptions) {
    this.dir = opts.dir;
    this.masterKeyOverride = opts.masterKey;
    this.masterKey = null;
  }

  /** Initialize: create dir, load or generate master key. Idempotent. */
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });

    if (this.masterKeyOverride) {
      this.masterKey = this.masterKeyOverride;
      return;
    }

    const envKey = process.env[ENV_VAR];
    if (envKey && envKey.length >= 16) {
      this.masterKey = envKey;
      return;
    }

    // Try to load from disk
    const keyPath = join(this.dir, MASTER_KEY_FILE);
    try {
      const existing = (await readFile(keyPath, "utf-8")).trim();
      if (existing.length >= 16) {
        this.masterKey = existing;
        return;
      }
    } catch {
      // doesn't exist — generate one
    }

    // Generate a new random key (256 bits encoded as hex = 64 chars)
    const newKey = randomBytes(32).toString("hex");
    await writeFile(keyPath, newKey, { encoding: "utf-8", mode: 0o600 });
    try {
      await chmod(keyPath, 0o600);
    } catch {
      // chmod may not be supported on all FS — non-fatal
    }
    this.masterKey = newKey;
  }

  private requireKey(): string {
    if (!this.masterKey) {
      throw new CredentialError(
        "CredentialStore is not initialized. Call init() first."
      );
    }
    return this.masterKey;
  }

  // ─── CredentialStore interface ──────────────────────────────────────────

  async resolve(ref: CredentialRef): Promise<CredentialPayload> {
    const cached = this.decryptCache.get(ref.credentialId);
    if (cached) return cached;

    const record = await this.loadRecord(ref.credentialId);
    if (!record) {
      throw new CredentialError(`Credential not found: ${ref.credentialId}`);
    }
    const payload = decryptPayload<CredentialPayload>(record.encryptedData, this.requireKey());
    this.decryptCache.set(ref.credentialId, payload);
    return payload;
  }

  async list(): Promise<CredentialSummary[]> {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    const out: CredentialSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const record = await this.loadRecordFromFile(join(this.dir, file));
        if (record) out.push(toSummary(record));
      } catch {
        // skip malformed
      }
    }

    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  async get(id: string): Promise<CredentialSummary | null> {
    const record = await this.loadRecord(id);
    return record ? toSummary(record) : null;
  }

  async create(input: {
    type: string;
    name: string;
    description?: string;
    data: CredentialPayload;
  }): Promise<CredentialSummary> {
    const now = new Date().toISOString();
    const record: CredentialRecord = {
      id: uuidv7(),
      type: input.type,
      name: input.name,
      description: input.description,
      encryptedData: encryptPayload(input.data, this.requireKey()),
      createdAt: now,
      updatedAt: now,
    };
    await this.writeRecord(record);
    return toSummary(record);
  }

  async update(
    id: string,
    input: Partial<{ name: string; description: string; data: CredentialPayload }>
  ): Promise<CredentialSummary> {
    const existing = await this.loadRecord(id);
    if (!existing) {
      throw new CredentialError(`Credential not found: ${id}`);
    }

    const updated: CredentialRecord = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      encryptedData: input.data
        ? encryptPayload(input.data, this.requireKey())
        : existing.encryptedData,
      updatedAt: new Date().toISOString(),
    };

    await this.writeRecord(updated);
    this.decryptCache.delete(id);
    return toSummary(updated);
  }

  async delete(id: string): Promise<boolean> {
    const filePath = this.fileFor(id);
    try {
      await stat(filePath);
      await unlink(filePath);
      this.decryptCache.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  /** Clear in-memory decrypt cache. Useful between executions for paranoid users. */
  clearCache(): void {
    this.decryptCache.clear();
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private fileFor(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  private async loadRecord(id: string): Promise<CredentialRecord | null> {
    return this.loadRecordFromFile(this.fileFor(id));
  }

  private async loadRecordFromFile(path: string): Promise<CredentialRecord | null> {
    try {
      const text = await readFile(path, "utf-8");
      return JSON.parse(text) as CredentialRecord;
    } catch {
      return null;
    }
  }

  private async writeRecord(record: CredentialRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.fileFor(record.id), JSON.stringify(record, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    try {
      await chmod(this.fileFor(record.id), 0o600);
    } catch {
      // ignore
    }
  }
}

function toSummary(r: CredentialRecord): CredentialSummary {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Convenience factory using workflowDir. */
export async function createFileCredentialStore(workflowDir: string): Promise<FileCredentialStore> {
  const store = new FileCredentialStore({ dir: join(workflowDir, CRED_DIR_NAME) });
  await store.init();
  return store;
}
