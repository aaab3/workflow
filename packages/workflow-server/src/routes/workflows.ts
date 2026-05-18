/**
 * Workflow CRUD API routes.
 */

import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { buildGraph, GraphValidationError } from "@openclaw/workflow-engine";
import type { Workflow } from "@openclaw/workflow-engine";
import type { FileWorkflowStorage } from "../storage/file-storage.js";

export async function workflowRoutes(
  app: FastifyInstance,
  opts: { storage: FileWorkflowStorage }
): Promise<void> {
  const { storage } = opts;

  // List all workflows
  app.get("/api/workflows", async (_req, reply) => {
    const workflows = await storage.list();
    return reply.send(
      workflows.map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        version: wf.version,
        nodeCount: wf.nodes.length,
        createdAt: wf.createdAt,
        updatedAt: wf.updatedAt,
      }))
    );
  });

  // Get workflow by ID
  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    const workflow = await storage.get(req.params.id);
    if (!workflow) {
      return reply.status(404).send({ error: "Workflow not found" });
    }
    return reply.send(workflow);
  });

  // Create workflow (with schema validation)
  app.post("/api/workflows", {
    schema: {
      body: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string", maxLength: 200 },
          description: { type: "string", maxLength: 2000 },
          version: { type: "string" },
          nodes: { type: "array" },
          edges: { type: "array" },
          variables: { type: "array" },
          triggers: { type: "array" },
          settings: { type: "object" },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as Partial<Workflow>;
    const workflow: Workflow = {
      id: body.id || uuidv7(),
      name: body.name || "Untitled Workflow",
      description: body.description,
      version: body.version || "1.0.0",
      nodes: body.nodes || [],
      edges: body.edges || [],
      variables: body.variables || [],
      triggers: body.triggers || [{ type: "manual", enabled: true, config: {} }],
      settings: body.settings || {
        maxExecutionTime: 300000,
        maxNodeRetries: 0,
        errorStrategy: "fail-fast",
        concurrencyLimit: 10,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = await storage.create(workflow);
    return reply.status(201).send(created);
  });

  // Update workflow
  app.put<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    try {
      const updated = await storage.update(req.params.id, req.body as Partial<Workflow>);
      return reply.send(updated);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return reply.status(404).send({ error: "Workflow not found" });
      }
      throw error;
    }
  });

  // Delete workflow
  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    const deleted = await storage.delete(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: "Workflow not found" });
    }
    return reply.status(204).send();
  });

  // Clone workflow
  app.post<{ Params: { id: string } }>("/api/workflows/:id/clone", async (req, reply) => {
    const original = await storage.get(req.params.id);
    if (!original) {
      return reply.status(404).send({ error: "Workflow not found" });
    }

    const clone: Workflow = {
      ...original,
      id: uuidv7(),
      name: `${original.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = await storage.create(clone);
    return reply.status(201).send(created);
  });

  // Validate workflow
  app.post<{ Params: { id: string } }>("/api/workflows/:id/validate", async (req, reply) => {
    const workflow = await storage.get(req.params.id);
    if (!workflow) {
      return reply.status(404).send({ error: "Workflow not found" });
    }

    try {
      const graph = buildGraph(workflow);
      return reply.send({
        valid: true,
        entryNodes: graph.entryNodes,
        executionOrder: graph.sortedIds,
        nodeCount: workflow.nodes.length,
        edgeCount: workflow.edges.length,
      });
    } catch (error) {
      if (error instanceof GraphValidationError) {
        return reply.status(422).send({
          valid: false,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }
  });

  // Export workflow
  app.get<{ Params: { id: string } }>("/api/workflows/:id/export", async (req, reply) => {
    const workflow = await storage.get(req.params.id);
    if (!workflow) {
      return reply.status(404).send({ error: "Workflow not found" });
    }
    return reply
      .header("Content-Type", "application/json")
      .header("Content-Disposition", `attachment; filename="${workflow.name}.json"`)
      .send(workflow);
  });

  // Import workflow
  app.post("/api/workflows/import", async (req, reply) => {
    const body = req.body as Workflow;
    if (!body.nodes || !body.edges) {
      return reply.status(400).send({ error: "Invalid workflow format" });
    }

    const workflow: Workflow = {
      ...body,
      id: body.id || uuidv7(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = await storage.create(workflow);
    return reply.status(201).send(created);
  });
}
