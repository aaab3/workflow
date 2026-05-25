/**
 * Credential CRUD route tests + FileCredentialStore tests.
 *
 * Verifies:
 * - HTTP CRUD endpoints
 * - Encrypted on disk (plaintext NOT in file)
 * - Master key from env or generated file
 * - Resolve flow returns plaintext
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server.js";
import { createFileCredentialStore } from "../src/storage/credential-store.js";
import { makeCredentialRef } from "@openclaw/workflow-engine";

let app: FastifyInstance;
let workflowDir: string;

beforeEach(async () => {
  workflowDir = await mkdtemp(join(tmpdir(), "wf-cred-"));
  // Use a test master key
  process.env.OPENCLAW_ENCRYPTION_KEY = "test-key-please-rotate-32-chars-1234";
  const server = await createServer({ workflowDir, port: 0, silent: true });
  app = server.app;
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(workflowDir, { recursive: true, force: true });
  delete process.env.OPENCLAW_ENCRYPTION_KEY;
});

describe("POST /api/credentials", () => {
  it("creates a credential and stores it encrypted on disk", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: {
        type: "openai-api-key",
        name: "My OpenAI Key",
        description: "for testing",
        data: { apiKey: "sk-secret-123", baseUrl: "https://api.openai.com/v1" },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.type).toBe("openai-api-key");
    expect(body.name).toBe("My OpenAI Key");

    // Critical: response does NOT include the secret
    expect(JSON.stringify(body)).not.toContain("sk-secret-123");

    // Disk: file exists, encrypted
    const credFile = join(workflowDir, ".credentials", `${body.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    const fileContent = await readFile(credFile, "utf-8");
    expect(fileContent).not.toContain("sk-secret-123");
    expect(fileContent).toContain("encryptedData");
  });

  it("rejects payload missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: { type: "x" }, // no name, no data
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/credentials", () => {
  it("returns summaries without secret data", async () => {
    await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: {
        type: "openai-api-key",
        name: "Key1",
        data: { apiKey: "sk-1" },
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: {
        type: "http-basic-auth",
        name: "Key2",
        data: { username: "u", password: "p" },
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/credentials" });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.length).toBe(2);
    // No secret fields leaked
    const text = JSON.stringify(list);
    expect(text).not.toContain("sk-1");
    expect(text).not.toContain("password");
  });

  it("returns 404 for unknown ID", async () => {
    const res = await app.inject({ method: "GET", url: "/api/credentials/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/credentials/:id", () => {
  it("updates name without re-encrypting data", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: {
        type: "openai-api-key",
        name: "Old Name",
        data: { apiKey: "sk-1" },
      },
    });
    const { id } = create.json();

    const res = await app.inject({
      method: "PUT",
      url: `/api/credentials/${id}`,
      payload: { name: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("New Name");
  });

  it("updates encrypted data when data field is provided", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: {
        type: "openai-api-key",
        name: "Key",
        data: { apiKey: "sk-old" },
      },
    });
    const { id } = create.json();

    const res = await app.inject({
      method: "PUT",
      url: `/api/credentials/${id}`,
      payload: { data: { apiKey: "sk-new" } },
    });
    expect(res.statusCode).toBe(200);

    // Verify file was re-encrypted with new value (and old value not present)
    const credFile = join(workflowDir, ".credentials", `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    const fileContent = await readFile(credFile, "utf-8");
    expect(fileContent).not.toContain("sk-old");
    expect(fileContent).not.toContain("sk-new"); // encrypted
  });

  it("returns 404 when updating non-existent", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/credentials/nope",
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/credentials/:id", () => {
  it("deletes a credential", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: { type: "x", name: "y", data: { secret: "z" } },
    });
    const { id } = create.json();

    const del = await app.inject({ method: "DELETE", url: `/api/credentials/${id}` });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: `/api/credentials/${id}` });
    expect(get.statusCode).toBe(404);
  });
});

describe("FileCredentialStore.resolve", () => {
  it("resolves to the original plaintext payload", async () => {
    const store = await createFileCredentialStore(workflowDir);
    const created = await store.create({
      type: "openai-api-key",
      name: "Test",
      data: { apiKey: "sk-123", baseUrl: "https://api.x.com" },
    });

    const resolved = await store.resolve(makeCredentialRef(created.id));
    expect(resolved).toEqual({ apiKey: "sk-123", baseUrl: "https://api.x.com" });
  });

  it("survives reload (encryption key from env is consistent)", async () => {
    // First store creates a credential
    const store1 = await createFileCredentialStore(workflowDir);
    const created = await store1.create({
      type: "test",
      name: "T",
      data: { secret: "value-survives-reload" },
    });

    // Second store (simulating restart) reads the same credential
    const store2 = await createFileCredentialStore(workflowDir);
    const resolved = await store2.resolve(makeCredentialRef(created.id));
    expect(resolved).toEqual({ secret: "value-survives-reload" });
  });
});

describe("Master key generation (no env var)", () => {
  it("generates and persists master.key when env var is not set", async () => {
    delete process.env.OPENCLAW_ENCRYPTION_KEY;
    const tempDir = await mkdtemp(join(tmpdir(), "wf-cred-genkey-"));
    try {
      const store1 = await createFileCredentialStore(tempDir);
      await store1.create({ type: "x", name: "y", data: { s: "1" } });

      // master.key should now exist
      const keyContent = await readFile(join(tempDir, ".credentials", "master.key"), "utf-8");
      expect(keyContent.length).toBeGreaterThanOrEqual(16);

      // Reload still works (key persisted)
      const store2 = await createFileCredentialStore(tempDir);
      const list = await store2.list();
      expect(list.length).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
