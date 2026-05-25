/**
 * Engine integration test: credential reference resolution.
 *
 * Verifies that:
 * - Engine replaces { __credentialRef } markers in config before execute()
 * - Modules see plaintext values
 * - Missing store throws a clear error
 * - Missing field throws a clear error
 */

import { describe, it, expect } from "vitest";
import { WorkflowEngine } from "../src/engine.js";
import { ModuleRegistry } from "../src/module-registry.js";
import { makeCredentialRef } from "../src/credentials.js";
import type {
  Workflow,
  ModuleHandler,
  ExecutionContext,
} from "../src/types.js";
import type {
  CredentialPayload,
  CredentialRef,
  CredentialStore,
  CredentialSummary,
} from "../src/credentials.js";

class MockStore implements CredentialStore {
  private payloads = new Map<string, CredentialPayload>();

  add(id: string, payload: CredentialPayload): void {
    this.payloads.set(id, payload);
  }

  async resolve(ref: CredentialRef): Promise<CredentialPayload> {
    const p = this.payloads.get(ref.credentialId);
    if (!p) throw new Error(`mock: not found: ${ref.credentialId}`);
    return p;
  }

  async list(): Promise<CredentialSummary[]> {
    return [];
  }

  async get(): Promise<CredentialSummary | null> {
    return null;
  }

  async create(): Promise<CredentialSummary> {
    throw new Error("not implemented");
  }

  async update(): Promise<CredentialSummary> {
    throw new Error("not implemented");
  }

  async delete(): Promise<boolean> {
    return false;
  }
}

function makeWorkflow(config: Record<string, unknown>): Workflow {
  return {
    id: "wf",
    name: "test",
    version: "1.0.0",
    nodes: [
      {
        id: "n1",
        type: "test-capture",
        position: { x: 0, y: 0 },
        data: { label: "N", config, inputs: [], outputs: [] },
      },
    ],
    edges: [],
    variables: [],
    triggers: [],
    settings: {
      maxExecutionTime: 10000,
      maxNodeRetries: 0,
      errorStrategy: "fail-fast",
      concurrencyLimit: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeRegistry(captured: { config?: Record<string, unknown> }): ModuleRegistry {
  const reg = new ModuleRegistry();
  const handler: ModuleHandler = {
    meta: {
      id: "test-capture",
      name: "Capture",
      category: "tool",
      description: "",
      icon: "",
      inputs: [],
      outputs: [],
      configSchema: {},
    },
    async execute(_inputs, config: Record<string, unknown>, _ctx: ExecutionContext) {
      captured.config = JSON.parse(JSON.stringify(config));
      return { ok: true };
    },
  };
  reg.register(handler);
  return reg;
}

describe("Engine — credential resolution", () => {
  it("replaces a top-level credential ref with the full payload", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const engine = new WorkflowEngine(makeRegistry(captured));
    const store = new MockStore();
    store.add("cred-1", { apiKey: "sk-real-secret" });

    const wf = makeWorkflow({ secret: makeCredentialRef("cred-1") });

    await engine.execute(wf, { credentials: store });

    expect(captured.config).toEqual({ secret: { apiKey: "sk-real-secret" } });
  });

  it("replaces a field-scoped credential ref with the field value", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const engine = new WorkflowEngine(makeRegistry(captured));
    const store = new MockStore();
    store.add("cred-1", { apiKey: "sk-real-secret", baseUrl: "https://api.x.com" });

    const wf = makeWorkflow({
      apiKey: makeCredentialRef("cred-1", "apiKey"),
      baseUrl: makeCredentialRef("cred-1", "baseUrl"),
    });

    await engine.execute(wf, { credentials: store });

    expect(captured.config).toEqual({
      apiKey: "sk-real-secret",
      baseUrl: "https://api.x.com",
    });
  });

  it("walks nested objects and arrays", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const engine = new WorkflowEngine(makeRegistry(captured));
    const store = new MockStore();
    store.add("a", { token: "t-a" });
    store.add("b", { token: "t-b" });

    const wf = makeWorkflow({
      headers: {
        nested: { auth: makeCredentialRef("a", "token") },
      },
      array: [makeCredentialRef("b", "token"), "literal", { x: makeCredentialRef("a", "token") }],
    });

    await engine.execute(wf, { credentials: store });

    expect(captured.config).toEqual({
      headers: { nested: { auth: "t-a" } },
      array: ["t-b", "literal", { x: "t-a" }],
    });
  });

  it("throws if a credential is referenced but no store is provided", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const engine = new WorkflowEngine(makeRegistry(captured));

    const wf = makeWorkflow({ secret: makeCredentialRef("cred-1") });

    const ctx = await engine.execute(wf); // no credentials option

    expect(ctx.status).toBe("failed");
    const err = ctx.errors[0]!.message;
    expect(err).toContain("credential");
  });

  it("throws if the referenced field does not exist", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const engine = new WorkflowEngine(makeRegistry(captured));
    const store = new MockStore();
    store.add("cred-1", { apiKey: "abc" });

    const wf = makeWorkflow({ secret: makeCredentialRef("cred-1", "nonexistent") });

    const ctx = await engine.execute(wf, { credentials: store });

    expect(ctx.status).toBe("failed");
    const err = ctx.errors[0]!.message;
    expect(err).toMatch(/nonexistent|field/i);
  });

  it("does not affect non-credential config values", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const engine = new WorkflowEngine(makeRegistry(captured));
    const store = new MockStore();
    store.add("cred-1", { key: "secret" });

    const wf = makeWorkflow({
      url: "https://api.example.com",
      apiKey: makeCredentialRef("cred-1", "key"),
      timeout: 5000,
      retries: 3,
    });

    await engine.execute(wf, { credentials: store });

    expect(captured.config).toEqual({
      url: "https://api.example.com",
      apiKey: "secret",
      timeout: 5000,
      retries: 3,
    });
  });
});
