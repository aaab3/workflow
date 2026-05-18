import { describe, it, expect } from "vitest";
import { WorkflowEngine } from "../src/engine.js";
import { ModuleRegistry } from "../src/module-registry.js";
import { fileReadModule, fileWriteModule, javascriptModule } from "../src/modules/index.js";
import type { Workflow, ModuleHandler, EngineEvent } from "../src/types.js";

function createTestRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.register(fileReadModule);
  registry.register(fileWriteModule);
  registry.register(javascriptModule);
  return registry;
}

/** A simple pass-through module for testing */
const echoModule: ModuleHandler = {
  meta: {
    id: "test-echo",
    name: "Echo",
    category: "tool",
    description: "Returns inputs as outputs",
    icon: "echo",
    inputs: [{ id: "value", name: "Value", type: "any" }],
    outputs: [{ id: "value", name: "Value", type: "any" }],
    configSchema: {},
  },
  async execute(inputs) {
    return { value: inputs.value ?? "echo" };
  },
};

/** A module that always fails */
const failModule: ModuleHandler = {
  meta: {
    id: "test-fail",
    name: "Fail",
    category: "tool",
    description: "Always fails",
    icon: "x",
    inputs: [],
    outputs: [],
    configSchema: {},
  },
  async execute() {
    throw new Error("Intentional failure");
  },
};

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "test-wf",
    name: "Test Workflow",
    version: "1.0.0",
    nodes: [],
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
    ...overrides,
  };
}

describe("WorkflowEngine", () => {
  it("should execute a single-node workflow", async () => {
    const registry = new ModuleRegistry();
    registry.register(echoModule);

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        {
          id: "n1",
          type: "test-echo",
          position: { x: 0, y: 0 },
          data: { label: "Echo", config: {}, inputs: [], outputs: [] },
        },
      ],
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("completed");
    expect(ctx.metrics.completedNodes).toBe(1);
    expect(ctx.metrics.failedNodes).toBe(0);
  });

  it("should execute a linear three-node workflow in order", async () => {
    const registry = new ModuleRegistry();
    const executionOrder: string[] = [];

    const makeOrderedModule = (id: string): ModuleHandler => ({
      meta: { id, name: id, category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute() {
        executionOrder.push(id);
        return { done: true };
      },
    });

    registry.register(makeOrderedModule("step-1"));
    registry.register(makeOrderedModule("step-2"));
    registry.register(makeOrderedModule("step-3"));

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "step-1", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "b", type: "step-2", position: { x: 100, y: 0 }, data: { label: "B", config: {}, inputs: [], outputs: [] } },
        { id: "c", type: "step-3", position: { x: 200, y: 0 }, data: { label: "C", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
        { id: "e2", source: "b", sourceHandle: "out", target: "c", targetHandle: "in" },
      ],
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("completed");
    expect(executionOrder).toEqual(["step-1", "step-2", "step-3"]);
  });

  it("should fail-fast when a node fails", async () => {
    const registry = new ModuleRegistry();
    registry.register(echoModule);
    registry.register(failModule);

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test-echo", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "b", type: "test-fail", position: { x: 100, y: 0 }, data: { label: "B", config: {}, inputs: [], outputs: [] } },
        { id: "c", type: "test-echo", position: { x: 200, y: 0 }, data: { label: "C", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
        { id: "e2", source: "b", sourceHandle: "out", target: "c", targetHandle: "in" },
      ],
      settings: {
        maxExecutionTime: 10000,
        maxNodeRetries: 0,
        errorStrategy: "fail-fast",
        concurrencyLimit: 10,
      },
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("failed");
    expect(ctx.metrics.completedNodes).toBe(1); // only 'a' completed
    expect(ctx.metrics.failedNodes).toBe(1);    // 'b' failed
    // 'c' should not have been executed
    const cState = ctx.nodeStates.get("c");
    expect(cState?.status).toBe("pending");
  });

  it("should continue execution on error with continue strategy", async () => {
    const registry = new ModuleRegistry();
    registry.register(echoModule);
    registry.register(failModule);

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test-echo", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "b", type: "test-fail", position: { x: 100, y: 0 }, data: { label: "B", config: {}, inputs: [], outputs: [] } },
        { id: "c", type: "test-echo", position: { x: 200, y: 0 }, data: { label: "C", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
        { id: "e2", source: "b", sourceHandle: "out", target: "c", targetHandle: "in" },
      ],
      settings: {
        maxExecutionTime: 10000,
        maxNodeRetries: 0,
        errorStrategy: "continue",
        concurrencyLimit: 10,
      },
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("failed"); // has failures
    expect(ctx.metrics.completedNodes).toBe(1);
    expect(ctx.metrics.failedNodes).toBe(1);
    expect(ctx.metrics.skippedNodes).toBe(1); // 'c' skipped
    const cState = ctx.nodeStates.get("c");
    expect(cState?.status).toBe("skipped");
  });

  it("should retry failed nodes according to settings", async () => {
    const registry = new ModuleRegistry();
    let attempts = 0;

    const flakeyModule: ModuleHandler = {
      meta: { id: "test-flakey", name: "Flakey", category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute() {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return { success: true };
      },
    };

    registry.register(flakeyModule);

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        {
          id: "a",
          type: "test-flakey",
          position: { x: 0, y: 0 },
          data: { label: "A", config: {}, inputs: [], outputs: [] },
          settings: { retries: 3, retryDelay: 10, retryBackoff: "fixed" },
        },
      ],
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("completed");
    expect(attempts).toBe(3);
  });

  it("should emit events during execution", async () => {
    const registry = new ModuleRegistry();
    registry.register(echoModule);

    const engine = new WorkflowEngine(registry);
    const events: EngineEvent[] = [];
    engine.on((event) => events.push(event));

    const workflow = makeWorkflow({
      nodes: [
        { id: "n1", type: "test-echo", position: { x: 0, y: 0 }, data: { label: "N1", config: {}, inputs: [], outputs: [] } },
      ],
    });

    await engine.execute(workflow);

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("execution:start");
    expect(eventTypes).toContain("node:start");
    expect(eventTypes).toContain("node:complete");
    expect(eventTypes).toContain("execution:complete");
  });

  it("should fail when module is not found", async () => {
    const registry = new ModuleRegistry();
    const engine = new WorkflowEngine(registry);

    const workflow = makeWorkflow({
      nodes: [
        { id: "n1", type: "nonexistent-module", position: { x: 0, y: 0 }, data: { label: "N1", config: {}, inputs: [], outputs: [] } },
      ],
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("failed");
    expect(ctx.errors.length).toBeGreaterThan(0);
    expect(ctx.errors[0]?.code).toBe("MODULE_NOT_FOUND");
  });
});
