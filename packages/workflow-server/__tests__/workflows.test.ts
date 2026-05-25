/**
 * Workflow CRUD route tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server.js";
import type { Workflow } from "@openclaw/workflow-engine";

let app: FastifyInstance;
let workflowDir: string;

const minimalWorkflow: Partial<Workflow> = {
  name: "Test Workflow",
  description: "Test description",
  nodes: [
    {
      id: "n1",
      type: "data-transform",
      position: { x: 0, y: 0 },
      data: { label: "T1", config: { operation: "count" }, inputs: [], outputs: [] },
    },
  ],
  edges: [],
};

beforeEach(async () => {
  workflowDir = await mkdtemp(join(tmpdir(), "wf-crud-"));
  const server = await createServer({ workflowDir, port: 0, silent: true });
  app = server.app;
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(workflowDir, { recursive: true, force: true });
});

describe("POST /api/workflows", () => {
  it("should create a new workflow", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: minimalWorkflow,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("Test Workflow");
    expect(body.createdAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });

  it("should reject oversized name (schema validation)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: { ...minimalWorkflow, name: "x".repeat(300) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("should accept workflow with default settings", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: { name: "Defaults" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.settings).toBeDefined();
    expect(body.triggers.length).toBeGreaterThan(0);
  });
});

describe("GET /api/workflows", () => {
  it("should list created workflows", async () => {
    await app.inject({ method: "POST", url: "/api/workflows", payload: { ...minimalWorkflow, name: "WF1" } });
    await app.inject({ method: "POST", url: "/api/workflows", payload: { ...minimalWorkflow, name: "WF2" } });

    const res = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.length).toBe(2);
    expect(list[0].name).toBeTruthy();
    expect(list[0].nodeCount).toBe(1);
  });

  it("should return empty array when no workflows", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /api/workflows/:id", () => {
  it("should return a workflow by id", async () => {
    const create = await app.inject({ method: "POST", url: "/api/workflows", payload: minimalWorkflow });
    const { id } = create.json();

    const res = await app.inject({ method: "GET", url: `/api/workflows/${id}` });
    expect(res.statusCode).toBe(200);
    const wf = res.json();
    expect(wf.id).toBe(id);
    expect(wf.name).toBe("Test Workflow");
  });

  it("should return 404 for unknown id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workflows/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/workflows/:id", () => {
  it("should update a workflow", async () => {
    const create = await app.inject({ method: "POST", url: "/api/workflows", payload: minimalWorkflow });
    const { id } = create.json();

    const res = await app.inject({
      method: "PUT",
      url: `/api/workflows/${id}`,
      payload: { name: "Updated Name" },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.name).toBe("Updated Name");
    // ID should not change
    expect(updated.id).toBe(id);
    // updatedAt should differ from createdAt
    expect(updated.updatedAt).not.toBe(updated.createdAt);
  });

  it("should return 404 when updating non-existent", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/workflows/nonexistent",
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/workflows/:id", () => {
  it("should delete a workflow", async () => {
    const create = await app.inject({ method: "POST", url: "/api/workflows", payload: minimalWorkflow });
    const { id } = create.json();

    const del = await app.inject({ method: "DELETE", url: `/api/workflows/${id}` });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: `/api/workflows/${id}` });
    expect(get.statusCode).toBe(404);
  });

  it("should return 404 when deleting non-existent", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/workflows/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/workflows/:id/clone", () => {
  it("should clone a workflow with new id", async () => {
    const create = await app.inject({ method: "POST", url: "/api/workflows", payload: minimalWorkflow });
    const original = create.json();

    const clone = await app.inject({ method: "POST", url: `/api/workflows/${original.id}/clone` });
    expect(clone.statusCode).toBe(201);
    const cloned = clone.json();
    expect(cloned.id).not.toBe(original.id);
    expect(cloned.name).toContain("Copy");
  });
});

describe("POST /api/workflows/:id/validate", () => {
  it("should validate a valid workflow", async () => {
    const create = await app.inject({ method: "POST", url: "/api/workflows", payload: minimalWorkflow });
    const { id } = create.json();

    const res = await app.inject({ method: "POST", url: `/api/workflows/${id}/validate` });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.valid).toBe(true);
    expect(result.entryNodes).toContain("n1");
  });

  it("should reject a workflow with cycles", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: {
        name: "Cyclic",
        nodes: [
          { id: "a", type: "data-transform", position: { x: 0, y: 0 }, data: { label: "A", config: { operation: "count" }, inputs: [], outputs: [] } },
          { id: "b", type: "data-transform", position: { x: 0, y: 0 }, data: { label: "B", config: { operation: "count" }, inputs: [], outputs: [] } },
        ],
        edges: [
          { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
          { id: "e2", source: "b", sourceHandle: "out", target: "a", targetHandle: "in" },
        ],
      },
    });
    const { id } = create.json();

    const res = await app.inject({ method: "POST", url: `/api/workflows/${id}/validate` });
    expect(res.statusCode).toBe(422);
    const result = res.json();
    expect(result.valid).toBe(false);
  });
});
