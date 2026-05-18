/**
 * Credential CRUD API routes.
 *
 * Endpoints:
 *   GET    /api/credentials           — list (no secrets)
 *   GET    /api/credentials/:id       — get summary (no secrets)
 *   POST   /api/credentials           — create with payload (encrypts on disk)
 *   PUT    /api/credentials/:id       — update name/description/data
 *   DELETE /api/credentials/:id       — delete
 *
 * Plaintext credential payloads NEVER leave the server. Clients can only
 * write to and read summaries from this API.
 */

import type { FastifyInstance } from "fastify";
import type { FileCredentialStore } from "../storage/credential-store.js";

export async function credentialRoutes(
  app: FastifyInstance,
  opts: { store: FileCredentialStore }
): Promise<void> {
  const { store } = opts;

  // List credentials (summaries only)
  app.get("/api/credentials", async (_req, reply) => {
    const list = await store.list();
    return reply.send(list);
  });

  // Get one
  app.get<{ Params: { id: string } }>("/api/credentials/:id", async (req, reply) => {
    const summary = await store.get(req.params.id);
    if (!summary) return reply.status(404).send({ error: "Credential not found" });
    return reply.send(summary);
  });

  // Create
  app.post<{
    Body: { type: string; name: string; description?: string; data: Record<string, unknown> };
  }>(
    "/api/credentials",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            type: { type: "string", minLength: 1, maxLength: 100 },
            name: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            data: { type: "object" },
          },
          required: ["type", "name", "data"],
        },
      },
    },
    async (req, reply) => {
      const { type, name, description, data } = req.body;
      const created = await store.create({ type, name, description, data });
      return reply.status(201).send(created);
    }
  );

  // Update
  app.put<{
    Params: { id: string };
    Body: { name?: string; description?: string; data?: Record<string, unknown> };
  }>(
    "/api/credentials/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            data: { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const updated = await store.update(req.params.id, req.body);
        return reply.send(updated);
      } catch (err) {
        if (err instanceof Error && err.message.includes("not found")) {
          return reply.status(404).send({ error: "Credential not found" });
        }
        throw err;
      }
    }
  );

  // Delete
  app.delete<{ Params: { id: string } }>("/api/credentials/:id", async (req, reply) => {
    const deleted = await store.delete(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "Credential not found" });
    return reply.status(204).send();
  });
}
