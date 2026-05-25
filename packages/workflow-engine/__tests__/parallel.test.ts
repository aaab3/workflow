import { describe, it, expect } from "vitest";
import { WorkflowEngine } from "../src/engine.js";
import { ModuleRegistry } from "../src/module-registry.js";
import type { Workflow, ModuleHandler } from "../src/types.js";

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "test-wf",
    name: "Test",
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

describe("Parallel Execution", () => {
  it("should execute independent nodes concurrently", async () => {
    const registry = new ModuleRegistry();
    const executionLog: Array<{ nodeId: string; event: "start" | "end"; time: number }> = [];
    const startTime = Date.now();

    const makeDelayModule = (id: string, delayMs: number): ModuleHandler => ({
      meta: { id, name: id, category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute() {
        executionLog.push({ nodeId: id, event: "start", time: Date.now() - startTime });
        await new Promise((r) => setTimeout(r, delayMs));
        executionLog.push({ nodeId: id, event: "end", time: Date.now() - startTime });
        return { done: true };
      },
    });

    registry.register(makeDelayModule("slow-a", 50));
    registry.register(makeDelayModule("slow-b", 50));
    registry.register(makeDelayModule("slow-c", 50));

    const engine = new WorkflowEngine(registry);

    // Three independent nodes (no edges between them) → should run in parallel
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "slow-a", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "b", type: "slow-b", position: { x: 0, y: 100 }, data: { label: "B", config: {}, inputs: [], outputs: [] } },
        { id: "c", type: "slow-c", position: { x: 0, y: 200 }, data: { label: "C", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [], // No dependencies → all can run in parallel
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("completed");
    expect(ctx.metrics.completedNodes).toBe(3);

    // All three should start before any finishes (parallel execution)
    const starts = executionLog.filter((e) => e.event === "start");
    const ends = executionLog.filter((e) => e.event === "end");

    // All starts should happen before the first end (within reasonable tolerance)
    const lastStart = Math.max(...starts.map((s) => s.time));
    const firstEnd = Math.min(...ends.map((e) => e.time));
    expect(lastStart).toBeLessThan(firstEnd);

    // Total time should be ~50ms (parallel), not ~150ms (sequential)
    const totalTime = ctx.metrics.totalDuration!;
    expect(totalTime).toBeLessThan(120); // generous margin, but less than 3x50ms
  });

  it("should respect concurrency limit", async () => {
    const registry = new ModuleRegistry();
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const concurrencyModule: ModuleHandler = {
      meta: { id: "test-concurrent", name: "Concurrent", category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute() {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 30));
        currentConcurrent--;
        return { done: true };
      },
    };

    registry.register(concurrencyModule);

    const engine = new WorkflowEngine(registry);

    // 5 independent nodes with concurrency limit of 2
    const workflow = makeWorkflow({
      nodes: Array.from({ length: 5 }, (_, i) => ({
        id: `n${i}`,
        type: "test-concurrent",
        position: { x: 0, y: i * 100 },
        data: { label: `N${i}`, config: {}, inputs: [], outputs: [] },
      })),
      edges: [],
      settings: {
        maxExecutionTime: 10000,
        maxNodeRetries: 0,
        errorStrategy: "fail-fast",
        concurrencyLimit: 2,
      },
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("completed");
    expect(ctx.metrics.completedNodes).toBe(5);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("should execute dependent nodes sequentially even with parallel enabled", async () => {
    const registry = new ModuleRegistry();
    const executionOrder: string[] = [];

    const orderModule: ModuleHandler = {
      meta: { id: "test-order", name: "Order", category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute(_inputs, config) {
        const id = config.nodeId as string;
        executionOrder.push(id);
        return { value: id };
      },
    };

    registry.register(orderModule);

    const engine = new WorkflowEngine(registry);

    // Linear chain: a → b → c (must execute sequentially)
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test-order", position: { x: 0, y: 0 }, data: { label: "A", config: { nodeId: "a" }, inputs: [], outputs: [] } },
        { id: "b", type: "test-order", position: { x: 100, y: 0 }, data: { label: "B", config: { nodeId: "b" }, inputs: [], outputs: [] } },
        { id: "c", type: "test-order", position: { x: 200, y: 0 }, data: { label: "C", config: { nodeId: "c" }, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
        { id: "e2", source: "b", sourceHandle: "out", target: "c", targetHandle: "in" },
      ],
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("completed");
    expect(executionOrder).toEqual(["a", "b", "c"]);
  });

  it("should execute diamond pattern correctly (a → b,c → d)", async () => {
    const registry = new ModuleRegistry();
    const executionOrder: string[] = [];

    const trackModule: ModuleHandler = {
      meta: { id: "test-track", name: "Track", category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute(_inputs, config) {
        const id = config.nodeId as string;
        executionOrder.push(id);
        await new Promise((r) => setTimeout(r, 10));
        return { value: id };
      },
    };

    registry.register(trackModule);

    const engine = new WorkflowEngine(registry);

    // Diamond: a → (b, c) → d
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test-track", position: { x: 0, y: 100 }, data: { label: "A", config: { nodeId: "a" }, inputs: [], outputs: [] } },
        { id: "b", type: "test-track", position: { x: 100, y: 0 }, data: { label: "B", config: { nodeId: "b" }, inputs: [], outputs: [] } },
        { id: "c", type: "test-track", position: { x: 100, y: 200 }, data: { label: "C", config: { nodeId: "c" }, inputs: [], outputs: [] } },
        { id: "d", type: "test-track", position: { x: 200, y: 100 }, data: { label: "D", config: { nodeId: "d" }, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
        { id: "e2", source: "a", sourceHandle: "out", target: "c", targetHandle: "in" },
        { id: "e3", source: "b", sourceHandle: "out", target: "d", targetHandle: "in1" },
        { id: "e4", source: "c", sourceHandle: "out", target: "d", targetHandle: "in2" },
      ],
    });

    const ctx = await engine.execute(workflow);

    expect(ctx.status).toBe("completed");
    expect(ctx.metrics.completedNodes).toBe(4);

    // 'a' must be first
    expect(executionOrder[0]).toBe("a");
    // 'd' must be last
    expect(executionOrder[3]).toBe("d");
    // 'b' and 'c' can be in any order (parallel)
    expect(executionOrder.slice(1, 3).sort()).toEqual(["b", "c"]);
  });
});
