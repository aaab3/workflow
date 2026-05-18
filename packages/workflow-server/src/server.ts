/**
 * OpenClaw Workflow Server
 *
 * Fastify-based HTTP/WebSocket server for workflow management and execution.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { resolve, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { FileWorkflowStorage } from "./storage/file-storage.js";
import { createFileCredentialStore } from "./storage/credential-store.js";
import { workflowRoutes } from "./routes/workflows.js";
import { executionRoutes } from "./routes/executions.js";
import { credentialRoutes } from "./routes/credentials.js";
import { executionWebSocket } from "./ws/execution-ws.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  workflowDir?: string;
  /** Allowed CORS origins (default: localhost only) */
  corsOrigins?: string[];
  /** Disable logging (useful for tests) */
  silent?: boolean;
}

export async function createServer(options: ServerOptions = {}) {
  const {
    port = 3100,
    host = "127.0.0.1",
    workflowDir = resolve(process.cwd(), "workflows"),
    corsOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
    silent = false,
  } = options;

  const app = Fastify({
    logger: silent ? false : {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    },
    // Security: limit request body size (1MB default)
    bodyLimit: 1024 * 1024,
  });

  // Plugins — CORS restricted to localhost by default
  await app.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });
  await app.register(websocket);

  // Storage
  const storage = new FileWorkflowStorage(workflowDir);
  await storage.init();

  const credentialStore = await createFileCredentialStore(workflowDir);

  // Routes
  await app.register(workflowRoutes, { storage });
  await app.register(credentialRoutes, { store: credentialStore });
  await app.register(executionRoutes, { storage, workflowDir, credentialStore });
  await app.register(executionWebSocket, { storage, workflowDir, credentialStore });

  // Health check
  app.get("/api/health", async () => ({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  }));

  return { app, port, host };
}

// Start server if run directly (not when imported as a module)
async function main() {
  // Allow port override via env (used by e2e tests with isolated ports)
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  const host = process.env.HOST;
  const workflowDir = process.env.WORKFLOWS_DIR;

  const { app, port: actualPort, host: actualHost } = await createServer({ port, host, workflowDir });

  try {
    await app.listen({ port: actualPort, host: actualHost });
    console.log(`\n  OpenClaw Workflow Server running at http://${actualHost}:${actualPort}`);
    console.log(`  Health: http://${actualHost}:${actualPort}/api/health\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only auto-start when this file is executed directly via `node` or `tsx`
// (not when imported from tests or other modules)
const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? resolvePath(process.argv[1]) : "";

if (thisFile === entryFile) {
  main();
}
