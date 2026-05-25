/**
 * Workflow execution API routes.
 *
 * Execution modes:
 * - async=true (default): Returns { executionId, status: "running" } immediately.
 *   Poll GET /api/executions/:id or use WebSocket for status.
 * - async=false: Waits for completion before responding.
 */

import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { EventEmitter } from "node:events";
import {
  WorkflowEngine,
  createDefaultRegistry,
  createWorkflowServerSecurityConfig,
} from "@openclaw/workflow-engine";
import type { ExecutionContext, EngineEvent } from "@openclaw/workflow-engine";
import type { FileWorkflowStorage } from "../storage/file-storage.js";
import type { FileCredentialStore } from "../storage/credential-store.js";
import { ExecutionStorage } from "../storage/execution-storage.js";
import type { ExecutionRecord } from "../storage/execution-storage.js";

/** Update pending metrics from a new event (incremental, not full-scan). */
function applyEventToMetrics(
  metrics: { totalNodes: number; completedNodes: number; failedNodes: number; skippedNodes: number },
  event: EngineEvent
): void {
  if (event.type === "node:complete") {
    metrics.completedNodes++;
  } else if (event.type === "node:error" && !event.willRetry) {
    metrics.failedNodes++;
  } else if (event.type === "node:skip") {
    metrics.skippedNodes++;
  }
}

// ─── In-Memory Store with LRU + TTL ────────────────────────────────────────

const MAX_IN_MEMORY = 50;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CachedExecution {
  context: ExecutionContext | null; // null while execution is in progress
  events: EngineEvent[];
  cachedAt: number;
  /** EventEmitter for live event subscription (SSE clients listen on this) */
  emitter: EventEmitter;
  /** Pending status info while context is being built (only present during in-flight async execution) */
  pending?: {
    executionId: string;
    workflowId: string;
    startTime: number;
    totalNodes: number;
    /** Live metrics, incremented as events arrive (no full-scan) */
    metrics: { totalNodes: number; completedNodes: number; failedNodes: number; skippedNodes: number };
  };
}

const executions = new Map<string, CachedExecution>();

function cacheExecution(id: string, context: ExecutionContext, events: EngineEvent[]): void {
  if (executions.size >= MAX_IN_MEMORY) {
    const oldest = [...executions.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
    if (oldest) {
      oldest[1].emitter.removeAllListeners();
      executions.delete(oldest[0]);
    }
  }
  // Reuse existing emitter if this execution was previously pending
  const existing = executions.get(id);
  const emitter = existing?.emitter ?? new EventEmitter();
  emitter.setMaxListeners(50); // Allow up to 50 SSE subscribers per execution
  executions.set(id, { context, events, cachedAt: Date.now(), emitter });
  // Notify subscribers that execution is done
  emitter.emit("done", context.status);
}

/** Pre-register an in-flight execution so /stream and /:id can see it before completion */
function registerPendingExecution(id: string, workflowId: string, totalNodes: number, events: EngineEvent[]): CachedExecution {
  if (executions.size >= MAX_IN_MEMORY) {
    const oldest = [...executions.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
    if (oldest) {
      oldest[1].emitter.removeAllListeners();
      executions.delete(oldest[0]);
    }
  }
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  const entry: CachedExecution = {
    context: null,
    events,
    cachedAt: Date.now(),
    emitter,
    pending: {
      executionId: id,
      workflowId,
      startTime: Date.now(),
      totalNodes,
      metrics: { totalNodes, completedNodes: 0, failedNodes: 0, skippedNodes: 0 },
    },
  };
  executions.set(id, entry);
  return entry;
}

function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [id, entry] of executions) {
    if (now - entry.cachedAt > TTL_MS) executions.delete(id);
  }
}

setInterval(cleanExpiredCache, 5 * 60 * 1000).unref();

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function executionRoutes(
  app: FastifyInstance,
  opts: { storage: FileWorkflowStorage; workflowDir: string; credentialStore?: FileCredentialStore }
): Promise<void> {
  const { storage, workflowDir, credentialStore } = opts;
  const registry = createDefaultRegistry();
  const executionStorage = new ExecutionStorage(workflowDir);
  await executionStorage.init();

  // Default security config — scoped to workflowDir
  const securityConfig = createWorkflowServerSecurityConfig(workflowDir);

  // Execute workflow
  app.post<{ Params: { id: string }; Body: { inputs?: Record<string, unknown>; async?: boolean } }>(
    "/api/workflows/:id/execute",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            inputs: { type: "object" },
            async: { type: "boolean" },
          },
        },
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const workflow = await storage.get(req.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      const inputs = req.body?.inputs ?? {};
      const isAsync = req.body?.async !== false;

      if (isAsync) {
        // ─── True Async ──────────────────────────────────────────────
        // 1. Generate executionId upfront
        // 2. Pre-register a "running" record so it's queryable immediately
        // 3. Pre-register in-memory cache so events stream in real-time
        // 4. Start execution with the pre-allocated ID
        // 5. Return the ID right away
        const executionId = uuidv7();

        // Pre-register pending record on disk (so GET /:id works immediately)
        const pendingRecord: ExecutionRecord = {
          executionId,
          workflowId: workflow.id,
          status: "running",
          startTime: Date.now(),
          metrics: {
            totalNodes: workflow.nodes.length,
            completedNodes: 0,
            failedNodes: 0,
            skippedNodes: 0,
          },
        };
        await executionStorage.save(pendingRecord).catch((err) => {
          app.log.error({ executionId, err: err instanceof Error ? err.message : String(err) }, "Failed to save pending execution record");
        });

        // Build engine and pre-register in-memory cache for live observability
        const engine = new WorkflowEngine(registry);
        const events: EngineEvent[] = [];

        // Pre-register pending execution in cache so /stream and /:id work during execution
        const cacheEntry = registerPendingExecution(executionId, workflow.id, workflow.nodes.length, events);

        // Engine emits events; update incremental metrics and broadcast to SSE subscribers.
        engine.on((event) => {
          events.push(event);

          // Broadcast to SSE subscribers via EventEmitter (no polling)
          cacheEntry.emitter.emit("event", event);

          if (event.type === "node:complete" || event.type === "node:error" || event.type === "node:skip") {
            // Incrementally update pending metrics (no full-scan)
            if (cacheEntry.pending) {
              applyEventToMetrics(cacheEntry.pending.metrics, event);
              pendingRecord.metrics = { ...cacheEntry.pending.metrics };
            }
            executionStorage.save({ ...pendingRecord }).catch((err) => {
              app.log.warn({ executionId, err: err instanceof Error ? err.message : String(err) }, "Failed to update pending record");
            });
          }
        });

        // Start execution in background — do NOT await
        engine.execute(workflow, {
          inputs,
          security: securityConfig,
          credentials: credentialStore,
          executionId, // Inject the pre-allocated ID
        }).then(async (context) => {
          cacheExecution(context.executionId, context, events);
          const record = buildExecutionRecord(context);
          await executionStorage.save(record).catch((err) => {
            app.log.error({ executionId, err: err instanceof Error ? err.message : String(err) }, "Failed to save final execution record");
          });
        }).catch(async (error) => {
          app.log.error({ executionId, error: error instanceof Error ? error.message : String(error) }, "Background execution failed");
          const failedRecord: ExecutionRecord = {
            ...pendingRecord,
            status: "failed",
            endTime: Date.now(),
            errors: [{ nodeId: "<engine>", message: error instanceof Error ? error.message : String(error), code: "ENGINE_ERROR" }],
          };
          await executionStorage.save(failedRecord).catch((err) => {
            app.log.error({ executionId, err: err instanceof Error ? err.message : String(err) }, "Failed to save error record");
          });
        });

        return reply.status(202).send({
          executionId,
          status: "running",
          workflowId: workflow.id,
          message: `Execution started. Poll GET /api/executions/${executionId} for status.`,
        });
      } else {
        // ─── Sync: wait for completion ───────────────────────────────
        const engine = new WorkflowEngine(registry);
        const events: EngineEvent[] = [];
        engine.on((event) => events.push(event));

        const context = await engine.execute(workflow, {
          inputs,
          security: securityConfig,
          credentials: credentialStore,
        });
        cacheExecution(context.executionId, context, events);

        const record = buildExecutionRecord(context);
        await executionStorage.save(record).catch((err) => {
          app.log.error({ executionId: context.executionId, err: err instanceof Error ? err.message : String(err) }, "Failed to save sync execution record");
        });

        return reply.status(200).send({
          executionId: context.executionId,
          status: context.status,
          metrics: context.metrics,
          outputs: record.outputs,
          errors: context.errors.length > 0 ? context.errors : undefined,
        });
      }
    }
  );

  // Get execution status
  app.get<{ Params: { execId: string } }>("/api/executions/:execId", async (req, reply) => {
    // In-memory cache first (most up-to-date for completed)
    const cached = executions.get(req.params.execId);
    if (cached?.context) {
      const { context } = cached;
      const record = buildExecutionRecord(context);
      return reply.send({
        executionId: context.executionId,
        workflowId: context.workflowId,
        status: context.status,
        startTime: context.startTime,
        endTime: context.endTime,
        metrics: context.metrics,
        outputs: record.outputs,
        nodeStates: Object.fromEntries(
          Array.from(context.nodeStates.entries()).map(([id, state]) => [
            id,
            {
              status: state.status,
              startTime: state.startTime,
              endTime: state.endTime,
              retryCount: state.retryCount,
              error: state.error,
              output: state.output,
            },
          ])
        ),
        errors: context.errors,
      });
    }

    // Pending in-memory entry (execution started but not completed)
    if (cached?.pending) {
      // Build node states from events for live progress (uses discriminated union, no any)
      const nodeStates: Record<string, { status: string; startTime?: number; endTime?: number }> = {};
      for (const event of cached.events) {
        if (event.type === "node:start") {
          nodeStates[event.nodeId] = { status: "running", startTime: event.timestamp };
        } else if (event.type === "node:complete") {
          nodeStates[event.nodeId] = { ...nodeStates[event.nodeId], status: "completed", endTime: Date.now() };
        } else if (event.type === "node:error" && !event.willRetry) {
          nodeStates[event.nodeId] = { ...nodeStates[event.nodeId], status: "failed", endTime: Date.now() };
        } else if (event.type === "node:skip") {
          nodeStates[event.nodeId] = { ...nodeStates[event.nodeId], status: "skipped" };
        }
      }

      return reply.send({
        executionId: cached.pending.executionId,
        workflowId: cached.pending.workflowId,
        status: "running",
        startTime: cached.pending.startTime,
        metrics: { ...cached.pending.metrics }, // Use incremental counter, not full-scan
        nodeStates,
      });
    }

    // Fall back to disk (includes pending records for in-progress async executions)
    const record = await executionStorage.get(req.params.execId);
    if (!record) {
      return reply.status(404).send({ error: "Execution not found" });
    }
    return reply.send(record);
  });

  // Get execution logs/events
  app.get<{ Params: { execId: string } }>("/api/executions/:execId/logs", async (req, reply) => {
    const cached = executions.get(req.params.execId);
    if (!cached) {
      return reply.status(404).send({ error: "Execution not found (logs only available for recent executions)" });
    }
    return reply.send({
      executionId: cached.context?.executionId ?? cached.pending?.executionId ?? req.params.execId,
      logs: cached.context?.logs ?? [],
      events: cached.events,
    });
  });

  // Stream execution events via Server-Sent Events (SSE)
  // Uses EventEmitter pub/sub instead of polling — clients are notified
  // immediately when new events arrive on the execution.
  app.get<{ Params: { execId: string } }>("/api/executions/:execId/stream", async (req, reply) => {
    const execId = req.params.execId;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Helper to write SSE-formatted data safely
    const write = (event: string | null, data: unknown): boolean => {
      if (reply.raw.writableEnded) return false;
      try {
        if (event) reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch {
        return false;
      }
    };

    const cached = executions.get(execId);

    if (!cached) {
      // Not in cache — check disk for completed/failed records
      const record = await executionStorage.get(execId);
      if (!record) {
        write("error", { message: "Execution not found" });
      } else {
        // Already finished (or never had live events)
        write("done", { status: record.status });
      }
      reply.raw.end();
      return reply;
    }

    // Replay all events captured so far (catch-up)
    for (const event of cached.events) {
      if (!write(null, event)) return reply;
    }

    // If execution already completed, emit done and close
    if (cached.context) {
      const status = cached.context.status;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        write("done", { status });
        reply.raw.end();
        return reply;
      }
    }

    // Subscribe to live events via EventEmitter
    const onEvent = (event: EngineEvent) => write(null, event);
    const onDone = (status: string) => {
      write("done", { status });
      cleanup();
      if (!reply.raw.writableEnded) reply.raw.end();
    };

    const cleanup = () => {
      cached.emitter.off("event", onEvent);
      cached.emitter.off("done", onDone);
    };

    cached.emitter.on("event", onEvent);
    cached.emitter.on("done", onDone);

    // Heartbeat every 30s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      reply.raw.write(": heartbeat\n\n");
    }, 30000);

    // Cleanup on client disconnect
    req.raw.on("close", () => {
      cleanup();
      clearInterval(heartbeat);
    });

    // Safety timeout — close stale connections after 10 minutes
    const safetyTimeout = setTimeout(() => {
      cleanup();
      clearInterval(heartbeat);
      if (!reply.raw.writableEnded) reply.raw.end();
    }, 10 * 60 * 1000);

    // Keep the request handler alive while connection is open
    return new Promise<void>((resolve) => {
      req.raw.on("close", () => {
        clearTimeout(safetyTimeout);
        resolve();
      });
      cached.emitter.once("done", () => {
        clearTimeout(safetyTimeout);
        resolve();
      });
    });
  });

  // List executions
  app.get("/api/executions", async (_req, reply) => {
    const persisted = await executionStorage.list(100);
    const persistedIds = new Set(persisted.map(r => r.executionId));

    const inMemoryList = [...executions.values()]
      .filter(c => {
        const id = c.context?.executionId ?? c.pending?.executionId;
        return id && !persistedIds.has(id);
      })
      .map(c => {
        if (c.context) {
          return {
            executionId: c.context.executionId,
            workflowId: c.context.workflowId,
            status: c.context.status,
            startTime: c.context.startTime,
            endTime: c.context.endTime,
            metrics: c.context.metrics,
          };
        }
        // Pending entry — use incremental metrics, no full-scan
        return {
          executionId: c.pending!.executionId,
          workflowId: c.pending!.workflowId,
          status: "running" as const,
          startTime: c.pending!.startTime,
          endTime: undefined,
          metrics: { ...c.pending!.metrics },
        };
      });

    const combined = [...inMemoryList, ...persisted.map(r => ({
      executionId: r.executionId,
      workflowId: r.workflowId,
      status: r.status,
      startTime: r.startTime,
      endTime: r.endTime,
      metrics: r.metrics,
    }))];

    combined.sort((a, b) => b.startTime - a.startTime);
    return reply.send(combined);
  });

  // List available modules
  app.get("/api/modules", async (_req, reply) => reply.send(registry.listMeta()));

  // Get module details
  app.get<{ Params: { id: string } }>("/api/modules/:id", async (req, reply) => {
    const handler = registry.get(req.params.id);
    if (!handler) return reply.status(404).send({ error: "Module not found" });
    return reply.send(handler.meta);
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildExecutionRecord(context: ExecutionContext): ExecutionRecord {
  const outputs = context.status === "completed"
    ? Object.fromEntries(
        Array.from(context.nodeStates.entries())
          .filter(([_, s]) => s.status === "completed" && s.output !== undefined)
          .map(([id, s]) => [id, s.output])
      )
    : undefined;

  return {
    executionId: context.executionId,
    workflowId: context.workflowId,
    status: context.status,
    startTime: context.startTime,
    endTime: context.endTime,
    metrics: context.metrics,
    outputs,
    errors: context.errors.length > 0
      ? context.errors.map(e => ({ nodeId: e.nodeId, message: e.message, code: e.code }))
      : undefined,
  };
}
