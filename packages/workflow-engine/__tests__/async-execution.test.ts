/**
 * Async execution tests — verify the executionId injection scenario.
 *
 * This tests the critical user-facing scenario:
 * 1. Client sends a workflow execution request with a pre-allocated ID
 * 2. Server returns the ID immediately
 * 3. Client polls with that ID and gets the running/completed status
 */

import { describe, it, expect } from "vitest";
import { v7 as uuidv7 } from "uuid";
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

describe("Async Execution with Pre-allocated executionId", () => {
  it("should use the externally provided executionId", async () => {
    const registry = new ModuleRegistry();
    const echoModule: ModuleHandler = {
      meta: { id: "echo", name: "Echo", category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute() { return { value: "ok" }; },
    };
    registry.register(echoModule);

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        { id: "n1", type: "echo", position: { x: 0, y: 0 }, data: { label: "N1", config: {}, inputs: [], outputs: [] } },
      ],
    });

    // The critical part: caller pre-allocates an ID and passes it in
    const myId = uuidv7();
    const ctx = await engine.execute(workflow, { executionId: myId });

    // Engine should use the provided ID, not generate its own
    expect(ctx.executionId).toBe(myId);
  });

  it("should generate its own ID when none is provided (backward compat)", async () => {
    const registry = new ModuleRegistry();
    const echoModule: ModuleHandler = {
      meta: { id: "echo", name: "Echo", category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute() { return { value: "ok" }; },
    };
    registry.register(echoModule);

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        { id: "n1", type: "echo", position: { x: 0, y: 0 }, data: { label: "N1", config: {}, inputs: [], outputs: [] } },
      ],
    });

    const ctx = await engine.execute(workflow);
    expect(ctx.executionId).toBeTruthy();
    expect(ctx.executionId.length).toBeGreaterThan(0);
  });

  it("should support fire-and-forget pattern: caller knows ID before execution finishes", async () => {
    const registry = new ModuleRegistry();
    const slowModule: ModuleHandler = {
      meta: { id: "slow", name: "Slow", category: "tool", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
      async execute() {
        await new Promise(r => setTimeout(r, 100));
        return { done: true };
      },
    };
    registry.register(slowModule);

    const engine = new WorkflowEngine(registry);
    const workflow = makeWorkflow({
      nodes: [
        { id: "n1", type: "slow", position: { x: 0, y: 0 }, data: { label: "N1", config: {}, inputs: [], outputs: [] } },
      ],
    });

    // Simulate the server scenario: pre-allocate ID, return it to client, then await
    const myId = uuidv7();
    const promise = engine.execute(workflow, { executionId: myId });

    // At this point the server can return myId to the client immediately
    // (in real server code this would be `return reply.send({ executionId: myId })`)
    expect(myId).toBeTruthy();

    // Later, the execution completes
    const ctx = await promise;
    expect(ctx.executionId).toBe(myId);
    expect(ctx.status).toBe("completed");
  });
});
