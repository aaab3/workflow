/**
 * E2E test: workflow execution via the API (end-to-end through the UI proxy).
 *
 * Verifies that after the UI is loaded, the user can execute workflows
 * through the API and see the correct execution lifecycle.
 */

import { test, expect } from "@playwright/test";

test.describe("Workflow execution via API", () => {
  test("creates and executes a simple workflow", async ({ request }) => {
    // Create a workflow with a simple data-transform node
    const createRes = await request.post("/api/workflows", {
      data: {
        name: "E2E Test Workflow",
        description: "Created by Playwright e2e",
        nodes: [
          {
            id: "n1",
            type: "data-transform",
            position: { x: 100, y: 100 },
            data: {
              label: "Count",
              config: { operation: "count" },
              inputs: [],
              outputs: [],
            },
          },
        ],
        edges: [],
      },
    });

    expect(createRes.status()).toBe(201);
    const workflow = await createRes.json();
    expect(workflow.id).toBeTruthy();

    // Execute synchronously
    const execRes = await request.post(`/api/workflows/${workflow.id}/execute`, {
      data: { inputs: {}, async: false },
    });

    expect(execRes.status()).toBe(200);
    const result = await execRes.json();
    expect(result.executionId).toBeTruthy();
    expect(result.status).toBe("completed");
    expect(result.metrics.completedNodes).toBe(1);

    // Cleanup
    await request.delete(`/api/workflows/${workflow.id}`);
  });

  test("async execution returns immediately and is queryable", async ({ request }) => {
    const createRes = await request.post("/api/workflows", {
      data: {
        name: "Async Test",
        nodes: [
          {
            id: "n1",
            type: "flow-delay",
            position: { x: 100, y: 100 },
            data: {
              label: "Delay 200ms",
              config: { duration: 200 },
              inputs: [],
              outputs: [],
            },
          },
        ],
        edges: [],
      },
    });

    const workflow = await createRes.json();

    const startTime = Date.now();
    const execRes = await request.post(`/api/workflows/${workflow.id}/execute`, {
      data: { async: true },
    });
    const elapsed = Date.now() - startTime;

    // Should return quickly (< 1s) — not blocking on the 200ms delay
    expect(elapsed).toBeLessThan(1500);
    expect(execRes.status()).toBe(202);

    const accepted = await execRes.json();
    expect(accepted.executionId).toBeTruthy();
    expect(accepted.status).toBe("running");

    // Poll for completion
    let final;
    for (let i = 0; i < 20; i++) {
      const statusRes = await request.get(`/api/executions/${accepted.executionId}`);
      const status = await statusRes.json();
      if (status.status === "completed" || status.status === "failed") {
        final = status;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(final).toBeDefined();
    expect(final.status).toBe("completed");

    // Cleanup
    await request.delete(`/api/workflows/${workflow.id}`);
  });

  test("security policy blocks terminal commands by default", async ({ request }) => {
    const createRes = await request.post("/api/workflows", {
      data: {
        name: "Terminal Security Test",
        nodes: [
          {
            id: "n1",
            type: "io-terminal",
            position: { x: 0, y: 0 },
            data: {
              label: "Terminal",
              config: { command: "echo hello" },
              inputs: [],
              outputs: [],
            },
          },
        ],
        edges: [],
      },
    });

    const workflow = await createRes.json();

    const execRes = await request.post(`/api/workflows/${workflow.id}/execute`, {
      data: { async: false },
    });

    // Execution should "complete" with status: failed since terminal is disabled by default
    expect(execRes.status()).toBe(200);
    const result = await execRes.json();
    expect(result.status).toBe("failed");

    // Cleanup
    await request.delete(`/api/workflows/${workflow.id}`);
  });
});
