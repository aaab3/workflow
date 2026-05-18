/**
 * WebSocket execution tests.
 *
 * Critical: verify WebSocket path applies the same SecurityConfig as HTTP path.
 * No security bypass via WebSocket entry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { v7 as uuidv7 } from "uuid";
import WebSocket from "ws";
import { createServer } from "../src/server.js";
import type { Workflow } from "@openclaw/workflow-engine";

let serverHandle: { app: Awaited<ReturnType<typeof createServer>>["app"]; port: number };
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

async function collectMessages(ws: WebSocket, timeoutMs = 3000): Promise<unknown[]> {
  const messages: unknown[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve(messages);
    }, timeoutMs);

    ws.on("message", (data: Buffer) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        messages.push(data.toString());
      }
    });

    ws.on("close", () => {
      clearTimeout(timer);
      resolve(messages);
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

beforeEach(async () => {
  workflowDir = await mkdtemp(join(tmpdir(), "wf-ws-"));
  // Use port 0 to get a random available port
  const server = await createServer({ workflowDir, port: 0, silent: true });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  const address = server.app.server.address();
  if (!address || typeof address === "string") throw new Error("Failed to get server address");
  serverHandle = { app: server.app, port: address.port };
});

afterEach(async () => {
  await serverHandle.app.close();
  await rm(workflowDir, { recursive: true, force: true });
});

describe("WebSocket execution", () => {
  it("should reject unknown workflow", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverHandle.port}/ws/execute/nonexistent`);
    const messages = await collectMessages(ws, 2000);

    expect(messages.length).toBeGreaterThan(0);
    const errorMsg = messages.find((m): m is { type: string; message: string } =>
      typeof m === "object" && m !== null && (m as { type?: string }).type === "error"
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.message).toContain("not found");
  });

  it("should stream events for a valid workflow", async () => {
    const id = await makeTestWorkflow({
      nodes: [
        {
          id: "n1",
          type: "data-transform",
          position: { x: 0, y: 0 },
          data: { label: "T1", config: { operation: "count" }, inputs: [], outputs: [] },
        },
      ],
    });

    const ws = new WebSocket(`ws://127.0.0.1:${serverHandle.port}/ws/execute/${id}`);
    const messages = await collectMessages(ws, 3000);

    // Should receive multiple events
    expect(messages.length).toBeGreaterThan(2);
    const types = messages
      .filter((m): m is { type: string } => typeof m === "object" && m !== null && "type" in m)
      .map(m => m.type);
    expect(types).toContain("execution:start");
    expect(types).toContain("execution:summary");
  });

  it("should apply security policy via WebSocket (terminal disabled)", async () => {
    // Same security policy as HTTP route — terminal should be blocked by default
    const id = await makeTestWorkflow({
      nodes: [
        {
          id: "n1",
          type: "io-terminal",
          position: { x: 0, y: 0 },
          data: { label: "Term", config: { command: "echo hello" }, inputs: [], outputs: [] },
        },
      ],
    });

    const ws = new WebSocket(`ws://127.0.0.1:${serverHandle.port}/ws/execute/${id}`);
    const messages = await collectMessages(ws, 3000);

    // Execution should have failed (security blocked the terminal)
    const summary = messages.find((m): m is { type: string; status: string } =>
      typeof m === "object" && m !== null && (m as { type?: string }).type === "execution:summary"
    );
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("failed");

    // Or there was an error event
    const nodeError = messages.find((m): m is { type: string; error?: { message: string } } =>
      typeof m === "object" && m !== null && (m as { type?: string }).type === "node:error"
    );
    if (nodeError && nodeError.error) {
      expect(nodeError.error.message.toLowerCase()).toMatch(/disabled|blocked|security/);
    }
  });
});
