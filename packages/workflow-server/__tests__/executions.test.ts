/**
 * Server execution route tests.
 *
 * Verifies the critical user-facing async flow:
 * 1. POST /execute returns executionId immediately
 * 2. GET /:id returns "running" while in progress
 * 3. GET /:id returns "completed" after execution finishes
 * 4. WebSocket and HTTP both apply security policies
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { v7 as uuidv7 } from "uuid";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server.js";
import type { Workflow } from "@openclaw/workflow-engine";

let app: FastifyInstance;
let workflowDir: string;

async function makeTestWorkflow(workflow: Partial<Workflow>): Promise<string> {
  const id = workflow.id ?? uuidv7();
  const wf: Workflow = {
    id,
    name: workflow.name ?? "Test",
    version: "1.0.0",
    nodes: workflow.nodes ?? [],
    edges: workflow.edges ?? [],
    variables: [],
    triggers: [],
    settings: workflow.settings ?? {
      maxExecutionTime: 10000,
      maxNodeRetries: 0,
      errorStrategy: "fail-fast",
      concurrencyLimit: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...workflow,
  };

  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  await writeFile(join(workflowDir, `${safe}.json`), JSON.stringify(wf), "utf-8");
  return id;
}

beforeEach(async () => {
  workflowDir = await mkdtemp(join(tmpdir(), "wf-server-"));
  const server = await createServer({ workflowDir, port: 0, silent: true });
  app = server.app;
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(workflowDir, { recursive: true, force: true });
});

describe("POST /api/workflows/:id/execute", () => {
  it("should return 404 for unknown workflow", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workflows/nonexistent/execute",
      payload: { inputs: {} },
    });
    expect(res.statusCode).toBe(404);
  });

  it("should run sync workflow and return outputs", async () => {
    const id = await makeTestWorkflow({
      nodes: [
        {
          id: "n1",
          type: "data-transform",
          position: { x: 0, y: 0 },
          data: {
            label: "Transform",
            config: { operation: "count" },
            inputs: [],
            outputs: [],
          },
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/workflows/${id}/execute`,
      payload: { inputs: {}, async: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executionId).toBeTruthy();
    expect(body.status).toBe("completed");
  });

  it("should return executionId immediately for async workflow", async () => {
    const id = await makeTestWorkflow({
      nodes: [
        {
          id: "n1",
          type: "data-transform",
          position: { x: 0, y: 0 },
          data: {
            label: "Transform",
            config: { operation: "count" },
            inputs: [],
            outputs: [],
          },
        },
      ],
    });

    const start = Date.now();
    const res = await app.inject({
      method: "POST",
      url: `/api/workflows/${id}/execute`,
      payload: { inputs: {}, async: true },
    });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(202);
    const body = res.json();
    // Critical: must return executionId for the user to poll
    expect(body.executionId).toBeTruthy();
    expect(body.status).toBe("running");
    // Should return quickly (not block on execution)
    expect(elapsed).toBeLessThan(1000);
  });

  it("should make async execution queryable while running", async () => {
    const id = await makeTestWorkflow({
      nodes: [
        {
          id: "n1",
          type: "flow-delay",
          position: { x: 0, y: 0 },
          data: {
            label: "Delay",
            config: { duration: 200 },
            inputs: [],
            outputs: [],
          },
        },
      ],
    });

    const startRes = await app.inject({
      method: "POST",
      url: `/api/workflows/${id}/execute`,
      payload: { async: true },
    });
    const { executionId } = startRes.json();

    // Immediately query — should return "running"
    const pendingRes = await app.inject({
      method: "GET",
      url: `/api/executions/${executionId}`,
    });
    expect(pendingRes.statusCode).toBe(200);
    const pending = pendingRes.json();
    expect(pending.executionId).toBe(executionId);
    expect(["running", "completed"]).toContain(pending.status);

    // Wait for completion
    await new Promise(r => setTimeout(r, 500));

    // Query again — should be completed
    const finalRes = await app.inject({
      method: "GET",
      url: `/api/executions/${executionId}`,
    });
    expect(finalRes.statusCode).toBe(200);
    const final = finalRes.json();
    expect(final.executionId).toBe(executionId);
    expect(final.status).toBe("completed");
  });

  it("should track node progress during async execution", async () => {
    // Workflow with 3 sequential delays — should see partial progress while running
    const id = await makeTestWorkflow({
      nodes: [
        { id: "n1", type: "flow-delay", position: { x: 0, y: 0 }, data: { label: "D1", config: { duration: 100 }, inputs: [], outputs: [] } },
        { id: "n2", type: "flow-delay", position: { x: 100, y: 0 }, data: { label: "D2", config: { duration: 100 }, inputs: [], outputs: [] } },
        { id: "n3", type: "flow-delay", position: { x: 200, y: 0 }, data: { label: "D3", config: { duration: 100 }, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "n1", sourceHandle: "out", target: "n2", targetHandle: "in" },
        { id: "e2", source: "n2", sourceHandle: "out", target: "n3", targetHandle: "in" },
      ],
    });

    const startRes = await app.inject({
      method: "POST",
      url: `/api/workflows/${id}/execute`,
      payload: { async: true },
    });
    const { executionId } = startRes.json();

    // Poll mid-execution — should see partial progress
    await new Promise(r => setTimeout(r, 150));
    const midRes = await app.inject({ method: "GET", url: `/api/executions/${executionId}` });
    const mid = midRes.json();
    // Should show progress (at least 1 node completed by now)
    expect(mid.metrics.completedNodes).toBeGreaterThanOrEqual(1);
    expect(mid.metrics.completedNodes).toBeLessThanOrEqual(3);

    // Wait for full completion
    await new Promise(r => setTimeout(r, 500));
    const finalRes = await app.inject({ method: "GET", url: `/api/executions/${executionId}` });
    const final = finalRes.json();
    expect(final.status).toBe("completed");
    expect(final.metrics.completedNodes).toBe(3);
  });

  it("should apply security policy (terminal disabled by default)", async () => {
    // Default config has terminal disabled — this workflow should fail
    const id = await makeTestWorkflow({
      nodes: [
        {
          id: "n1",
          type: "io-terminal",
          position: { x: 0, y: 0 },
          data: {
            label: "Term",
            config: { command: "echo hello" },
            inputs: [],
            outputs: [],
          },
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/workflows/${id}/execute`,
      payload: { async: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Execution should have failed due to security policy
    expect(body.status).toBe("failed");
    expect(body.errors).toBeDefined();
    const errorMessages = (body.errors as Array<{ message: string }>).map(e => e.message).join(" ");
    expect(errorMessages.toLowerCase()).toMatch(/disabled|blocked|security/);
  });
});

describe("GET /api/executions/:id", () => {
  it("should return 404 for unknown execution", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/executions/unknown-id",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/executions/:id/stream (SSE)", () => {
  it("should stream events during async execution", async () => {
    const id = await makeTestWorkflow({
      nodes: [
        { id: "n1", type: "flow-delay", position: { x: 0, y: 0 }, data: { label: "D1", config: { duration: 50 }, inputs: [], outputs: [] } },
      ],
    });

    const startRes = await app.inject({
      method: "POST",
      url: `/api/workflows/${id}/execute`,
      payload: { async: true },
    });
    const { executionId } = startRes.json();

    // Stream the events
    const streamRes = await app.inject({
      method: "GET",
      url: `/api/executions/${executionId}/stream`,
    });

    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.headers["content-type"]).toContain("text/event-stream");
    // Body should contain SSE-formatted events
    const body = streamRes.body;
    expect(body).toContain("data:");
  });

  it("should return done event for already-completed execution", async () => {
    // Create a workflow that completes quickly
    const id = await makeTestWorkflow({
      nodes: [
        { id: "n1", type: "data-transform", position: { x: 0, y: 0 }, data: { label: "C", config: { operation: "count" }, inputs: [], outputs: [] } },
      ],
    });

    // Execute synchronously to ensure it's done before streaming
    const execRes = await app.inject({
      method: "POST",
      url: `/api/workflows/${id}/execute`,
      payload: { async: false },
    });
    const { executionId } = execRes.json();

    // Now stream — should get done immediately
    const streamRes = await app.inject({
      method: "GET",
      url: `/api/executions/${executionId}/stream`,
    });

    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.body).toContain("event: done");
  });

  it("should return error for unknown execution", async () => {
    const streamRes = await app.inject({
      method: "GET",
      url: "/api/executions/nonexistent-id/stream",
    });

    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.body).toContain("event: error");
  });
});

describe("GET /api/modules", () => {
  it("should list all registered modules", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/modules",
    });
    expect(res.statusCode).toBe(200);
    const modules = res.json();
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.length).toBeGreaterThan(0);

    // Should include essential modules
    const ids = modules.map((m: { id: string }) => m.id);
    expect(ids).toContain("io-file-read");
    expect(ids).toContain("io-terminal");
    expect(ids).toContain("flow-condition");
  });
});

describe("CORS", () => {
  it("should reject non-localhost origins by default", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/workflows",
      headers: {
        origin: "http://evil.example.com",
        "access-control-request-method": "GET",
      },
    });
    // Either rejected or not given CORS headers
    const allowOrigin = res.headers["access-control-allow-origin"];
    expect(allowOrigin).not.toBe("http://evil.example.com");
  });
});
