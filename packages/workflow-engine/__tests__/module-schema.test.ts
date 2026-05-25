/**
 * Tests for module schema infrastructure:
 * - Zod → JSON Schema conversion
 * - Engine validates config and inputs against Zod schemas
 * - Defaults are applied
 * - Validation errors are surfaced via standard error path
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { WorkflowEngine } from "../src/engine.js";
import { ModuleRegistry } from "../src/module-registry.js";
import {
  isZodSchema,
  zodToConfigSchema,
  validateWithZod,
} from "../src/module-schema.js";
import type { Workflow, ModuleHandler, ExecutionContext } from "../src/types.js";

// ─── Unit tests for the bridge ──────────────────────────────────────────────

describe("isZodSchema", () => {
  it("identifies Zod schemas", () => {
    expect(isZodSchema(z.string())).toBe(true);
    expect(isZodSchema(z.object({ a: z.number() }))).toBe(true);
    expect(isZodSchema(z.union([z.string(), z.number()]))).toBe(true);
  });

  it("rejects non-Zod values", () => {
    expect(isZodSchema({})).toBe(false);
    expect(isZodSchema({ type: "object" })).toBe(false);
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema(undefined)).toBe(false);
    expect(isZodSchema("string")).toBe(false);
  });
});

describe("zodToConfigSchema", () => {
  it("converts a basic object schema", () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().int().min(0).max(100),
    });
    const json = zodToConfigSchema(schema);
    expect(json.type).toBe("object");
    expect((json.properties as Record<string, unknown>).name).toBeDefined();
    expect((json.properties as Record<string, unknown>).count).toBeDefined();
  });

  it("preserves descriptions and defaults", () => {
    const schema = z.object({
      timeout: z.number().default(5000).describe("超时时间"),
    });
    const json = zodToConfigSchema(schema);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.timeout!.description).toBe("超时时间");
    expect(props.timeout!.default).toBe(5000);
  });

  it("strips $schema and $ref", () => {
    const schema = z.object({ x: z.number() });
    const json = zodToConfigSchema(schema);
    expect(json.$schema).toBeUndefined();
    expect(json.$ref).toBeUndefined();
  });
});

describe("validateWithZod", () => {
  const schema = z.object({
    url: z.string().url(),
    method: z.enum(["GET", "POST"]).default("GET"),
    timeout: z.number().int().min(100).default(30000),
  });

  it("returns ok with parsed defaults", () => {
    const result = validateWithZod(schema, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBe("https://example.com");
      expect(result.data.method).toBe("GET");
      expect(result.data.timeout).toBe(30000);
    }
  });

  it("returns errors with paths for invalid input", () => {
    const result = validateWithZod(schema, { url: "not-a-url", timeout: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((e) => e.path);
      expect(paths).toContain("url");
      expect(paths).toContain("timeout");
    }
  });

  it("rejects entirely missing input", () => {
    const result = validateWithZod(schema, {});
    expect(result.ok).toBe(false);
  });
});

// ─── Engine integration ─────────────────────────────────────────────────────

function makeWorkflow(handler: ModuleHandler, config: Record<string, unknown>): Workflow {
  return {
    id: "wf",
    name: "test",
    version: "1.0.0",
    nodes: [
      {
        id: "n1",
        type: handler.meta.id,
        position: { x: 0, y: 0 },
        data: { label: "N", config, inputs: [], outputs: [] },
      },
    ],
    edges: [],
    variables: [],
    triggers: [],
    settings: {
      maxExecutionTime: 5000,
      maxNodeRetries: 0,
      errorStrategy: "fail-fast",
      concurrencyLimit: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Engine — Zod config validation", () => {
  it("applies Zod defaults before execute()", async () => {
    let receivedConfig: Record<string, unknown> | undefined;

    const handler: ModuleHandler = {
      meta: {
        id: "test-defaults",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: {},
      },
      configZod: z.object({
        timeout: z.number().default(42),
        name: z.string().default("hello"),
      }),
      async execute(_inputs, config, _ctx) {
        receivedConfig = config;
        return { ok: true };
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);
    const engine = new WorkflowEngine(reg);

    const ctx = await engine.execute(makeWorkflow(handler, {}));

    expect(ctx.status).toBe("completed");
    expect(receivedConfig).toEqual({ timeout: 42, name: "hello" });
  });

  it("fails the node when config is invalid", async () => {
    const handler: ModuleHandler = {
      meta: {
        id: "test-invalid",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: {},
      },
      configZod: z.object({
        url: z.string().url(),
      }),
      async execute() {
        throw new Error("execute should not be called when validation fails");
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);
    const engine = new WorkflowEngine(reg);

    const ctx = await engine.execute(makeWorkflow(handler, { url: "not-a-url" }));

    expect(ctx.status).toBe("failed");
    expect(ctx.errors[0]!.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(ctx.errors[0]!.message).toMatch(/url/);
  });

  it("does not retry on validation errors (non-retryable)", async () => {
    let executeCount = 0;
    const handler: ModuleHandler = {
      meta: {
        id: "test-no-retry",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: {},
      },
      configZod: z.object({ port: z.number().int().min(1).max(65535) }),
      async execute() {
        executeCount++;
        return {};
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);
    const engine = new WorkflowEngine(reg);

    const wf = makeWorkflow(handler, { port: 99999 });
    wf.nodes[0]!.settings = { retries: 3 };

    const ctx = await engine.execute(wf);

    expect(ctx.status).toBe("failed");
    expect(executeCount).toBe(0); // Never called
    expect(ctx.errors[0]!.code).toBe("CONFIG_VALIDATION_ERROR");
  });

  it("auto-derives configSchema from configZod on registration", () => {
    const handler: ModuleHandler = {
      meta: {
        id: "test-derive",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: {}, // Empty — registry should fill this in
      },
      configZod: z.object({
        x: z.number().describe("a number"),
      }),
      async execute() {
        return {};
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);

    const meta = reg.get("test-derive")!.meta;
    expect(meta.configSchema.type).toBe("object");
    expect((meta.configSchema.properties as Record<string, Record<string, unknown>>).x.description).toBe("a number");
  });

  it("falls back gracefully for legacy modules without configZod", async () => {
    let receivedConfig: Record<string, unknown> | undefined;

    const handler: ModuleHandler = {
      meta: {
        id: "test-legacy",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: { type: "object", properties: { x: { type: "number" } } },
      },
      // No configZod — legacy mode
      async execute(_inputs, config) {
        receivedConfig = config;
        return {};
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);
    const engine = new WorkflowEngine(reg);

    // No validation, anything passes
    await engine.execute(makeWorkflow(handler, { x: 1, anything: "goes" }));

    expect(receivedConfig).toEqual({ x: 1, anything: "goes" });
  });
});

describe("Engine — Zod inputs validation", () => {
  it("validates inputs and applies defaults", async () => {
    let receivedInputs: Record<string, unknown> | undefined;

    const handler: ModuleHandler = {
      meta: {
        id: "test-inputs",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: {},
      },
      inputsZod: z.object({
        x: z.number().default(7),
      }),
      async execute(inputs, _config) {
        receivedInputs = inputs;
        return {};
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);
    const engine = new WorkflowEngine(reg);

    const ctx = await engine.execute(makeWorkflow(handler, {}));

    expect(ctx.status).toBe("completed");
    expect(receivedInputs).toEqual({ x: 7 });
  });
});

// ─── init / dispose lifecycle ──────────────────────────────────────────────

describe("ModuleRegistry — init/dispose lifecycle", () => {
  it("calls init() once via initAll()", async () => {
    let initCount = 0;
    const handler: ModuleHandler = {
      meta: {
        id: "test-init",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: {},
      },
      async init() {
        initCount++;
      },
      async execute() {
        return {};
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);
    await reg.initAll();
    expect(initCount).toBe(1);
  });

  it("calls dispose() via disposeAll()", async () => {
    let disposed = false;
    const handler: ModuleHandler = {
      meta: {
        id: "test-dispose",
        name: "T",
        category: "tool",
        description: "",
        icon: "",
        inputs: [],
        outputs: [],
        configSchema: {},
      },
      async dispose() {
        disposed = true;
      },
      async execute() {
        return {};
      },
    };

    const reg = new ModuleRegistry();
    reg.register(handler);
    await reg.disposeAll();
    expect(disposed).toBe(true);
  });
});
