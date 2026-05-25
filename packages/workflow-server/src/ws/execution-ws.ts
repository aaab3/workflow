/**
 * WebSocket handler for real-time execution events.
 *
 * Applies the same SecurityConfig as the HTTP route — no security bypass via WebSocket.
 */

import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { resolve } from "node:path";
import {
  WorkflowEngine,
  createDefaultRegistry,
  createWorkflowServerSecurityConfig,
} from "@openclaw/workflow-engine";
import type { EngineEvent } from "@openclaw/workflow-engine";
import type { FileWorkflowStorage } from "../storage/file-storage.js";
import type { FileCredentialStore } from "../storage/credential-store.js";

export async function executionWebSocket(
  app: FastifyInstance,
  opts: { storage: FileWorkflowStorage; workflowDir?: string; credentialStore?: FileCredentialStore }
): Promise<void> {
  const { storage, workflowDir, credentialStore } = opts;
  const securityConfig = createWorkflowServerSecurityConfig(workflowDir ?? resolve(process.cwd(), "workflows"));

  app.get<{ Params: { workflowId: string }; Querystring: { inputs?: string } }>(
    "/ws/execute/:workflowId",
    { websocket: true },
    async (socket: WebSocket, req) => {
      const workflow = await storage.get(req.params.workflowId);

      if (!workflow) {
        socket.send(JSON.stringify({ type: "error", message: "Workflow not found" }));
        socket.close();
        return;
      }

      // Parse inputs from query string
      let inputs: Record<string, unknown> = {};
      if (req.query.inputs) {
        try {
          inputs = JSON.parse(req.query.inputs);
        } catch {
          // ignore parse errors
        }
      }

      // Listen for client commands
      const abortController = new AbortController();

      socket.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "cancel") {
            abortController.abort();
          }
        } catch {
          // ignore invalid messages
        }
      });

      socket.on("close", () => {
        abortController.abort();
      });

      // Execute workflow with real-time event streaming
      const registry = createDefaultRegistry();
      const engine = new WorkflowEngine(registry);

      engine.on((event: EngineEvent) => {
        if (socket.readyState === 1) { // OPEN
          socket.send(JSON.stringify(event));
        }
      });

      try {
        const context = await engine.execute(workflow, {
          inputs,
          signal: abortController.signal,
          security: securityConfig, // Same security policy as HTTP route
          credentials: credentialStore,
        });

        // Send final summary
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: "execution:summary",
            executionId: context.executionId,
            status: context.status,
            metrics: context.metrics,
            duration: context.metrics.totalDuration,
          }));
        }
      } catch (error) {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: "execution:error",
            message: error instanceof Error ? error.message : String(error),
            fatal: true,
          }));
        }
      } finally {
        if (socket.readyState === 1) {
          socket.close();
        }
      }
    }
  );
}
