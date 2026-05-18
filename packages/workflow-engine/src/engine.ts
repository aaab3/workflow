/**
 * Workflow Graph Runner - the core execution engine.
 *
 * Executes a workflow by traversing the graph in topological order,
 * resolving expressions, invoking module handlers, and managing state.
 */

import { buildGraph, getDownstreamNodes, type Graph } from "./graph.js";
import {
  createExecutionContext,
  updateNodeStatus,
  setExecutionStatus,
  addLog,
  addError,
  getNodeOutputsMap,
} from "./context.js";
import { resolveExpressionsDeep, type ExpressionContext } from "./expression.js";
import { isCredentialRef, type CredentialRef } from "./credentials.js";
import { isZodSchema, validateWithZod, formatValidationErrors } from "./module-schema.js";
import { ModuleRegistry } from "./module-registry.js";
import type {
  Workflow,
  ExecutionContext,
  EngineEvent,
  WorkflowNode,
  NodeSettings,
  WorkflowSettings,
} from "./types.js";

export type EventListener = (event: EngineEvent) => void;

export interface EngineOptions {
  /** Override workflow settings */
  settings?: Partial<WorkflowSettings>;
  /** Input parameters for the workflow */
  inputs?: Record<string, unknown>;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Security configuration for module access control */
  security?: import("./security.js").SecurityConfig;
  /** Pre-allocated execution ID (for async API patterns) */
  executionId?: string;
  /** Credential store — supplied by the host (server / CLI) so modules can resolve secrets */
  credentials?: import("./credentials.js").CredentialStore;
}

export class WorkflowEngine {
  private listeners: EventListener[] = [];

  constructor(private readonly registry: ModuleRegistry) {}

  /**
   * Subscribe to engine events.
   */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break execution
      }
    }
  }

  /**
   * Execute a workflow and return the execution context with results.
   */
  async execute(workflow: Workflow, options: EngineOptions = {}): Promise<ExecutionContext> {
    // Build and validate graph
    const graph = buildGraph(workflow);

    // Create execution context (with optional pre-allocated executionId)
    const context = createExecutionContext(workflow, options.inputs, options.executionId);
    context.security = options.security;
    context.credentials = options.credentials;
    const defaultSettings: WorkflowSettings = {
      maxExecutionTime: 300000,
      maxNodeRetries: 0,
      errorStrategy: "fail-fast",
      concurrencyLimit: 10,
    };
    const settings: WorkflowSettings = { ...defaultSettings, ...workflow.settings, ...options.settings };

    // Start execution
    setExecutionStatus(context, "running");
    this.emit({ type: "execution:start", executionId: context.executionId, timestamp: Date.now() });

    // Set up execution timeout (cancellable)
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        setExecutionStatus(context, "failed");
        reject(new Error(`Workflow execution timed out after ${settings.maxExecutionTime}ms`));
      }, settings.maxExecutionTime);
    });

    try {
      // Execute nodes in topological order
      await Promise.race([
        this.executeGraph(graph, context, settings, options.signal),
        timeoutPromise,
      ]);

      // Determine final status
      if (context.status === "running") {
        const hasFailed = context.metrics.failedNodes > 0;
        setExecutionStatus(context, hasFailed ? "failed" : "completed");
      }
    } catch (error) {
      if (context.status !== "cancelled") {
        setExecutionStatus(context, "failed");
        const message = error instanceof Error ? error.message : String(error);
        this.emit({ type: "execution:error", message, fatal: true });
      }
    } finally {
      // Clear the timeout to prevent process hang (BUG 1 fix)
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    // Emit completion
    if (context.status === "completed") {
      this.emit({
        type: "execution:complete",
        outputs: this.collectFinalOutputs(graph, context),
        duration: context.metrics.totalDuration ?? 0,
        metrics: context.metrics,
      });
    }

    return context;
  }

  private async executeGraph(
    graph: Graph,
    context: ExecutionContext,
    settings: WorkflowSettings,
    signal?: AbortSignal
  ): Promise<void> {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const skipped = new Set<string>();
    const inProgress = new Set<string>();

    // Wave-based parallel execution:
    // Each iteration finds all nodes whose dependencies are satisfied,
    // then executes them concurrently (up to concurrencyLimit).
    while (true) {
      if (signal?.aborted) {
        setExecutionStatus(context, "cancelled");
        return;
      }

      // Find all ready nodes (dependencies satisfied, not yet processed)
      const readyNodes: string[] = [];
      for (const nodeId of graph.sortedIds) {
        if (completed.has(nodeId) || failed.has(nodeId) || skipped.has(nodeId) || inProgress.has(nodeId)) {
          continue;
        }

        const graphNode = graph.nodes.get(nodeId)!;

        // Check if all upstream dependencies are completed or skipped
        const allDepsResolved = graphNode.inEdges.every(
          (e) => completed.has(e.source) || skipped.has(e.source) || failed.has(e.source)
        );

        if (!allDepsResolved) continue;

        // Check if any upstream failed
        const upstreamFailed = graphNode.inEdges.some((e) => failed.has(e.source));

        if (upstreamFailed) {
          if (settings.errorStrategy === "continue") {
            skipped.add(nodeId);
            updateNodeStatus(context, nodeId, "skipped");
            this.emit({ type: "node:skip", nodeId, reason: "Upstream node failed" });
            this.skipDownstream(graph, nodeId, skipped, context);
            continue;
          }
          // fail-fast: stop
          return;
        }

        readyNodes.push(nodeId);
      }

      // No more nodes to execute
      if (readyNodes.length === 0) {
        break;
      }

      // Execute ready nodes in parallel (respecting concurrency limit)
      const batches = this.chunk(readyNodes, settings.concurrencyLimit);

      for (const batch of batches) {
        if (signal?.aborted) {
          setExecutionStatus(context, "cancelled");
          return;
        }

        for (const nodeId of batch) {
          inProgress.add(nodeId);
        }

        const results = await Promise.allSettled(
          batch.map(async (nodeId) => {
            const graphNode = graph.nodes.get(nodeId)!;
            const success = await this.executeNode(graphNode.node, graph, context, settings);
            return { nodeId, success };
          })
        );

        // Process results
        for (const result of results) {
          if (result.status === "fulfilled") {
            const { nodeId, success } = result.value;
            inProgress.delete(nodeId);

            if (success) {
              completed.add(nodeId);
            } else {
              failed.add(nodeId);

              if (settings.errorStrategy === "fail-fast") {
                return;
              }

              if (settings.errorStrategy === "continue") {
                this.skipDownstream(graph, nodeId, skipped, context);
              }
            }
          } else {
            // Promise rejected (shouldn't happen since executeNode catches errors)
            const nodeId = batch[results.indexOf(result)]!;
            inProgress.delete(nodeId);
            failed.add(nodeId);

            if (settings.errorStrategy === "fail-fast") {
              return;
            }
          }
        }
      }
    }
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private skipDownstream(
    graph: Graph,
    nodeId: string,
    skipped: Set<string>,
    context: ExecutionContext
  ): void {
    const downstream = getDownstreamNodes(graph, nodeId);
    for (const d of downstream) {
      if (!skipped.has(d)) {
        skipped.add(d);
        updateNodeStatus(context, d, "skipped");
        this.emit({ type: "node:skip", nodeId: d, reason: "Upstream node failed" });
        // Recursively skip further downstream
        this.skipDownstream(graph, d, skipped, context);
      }
    }
  }

  private async executeNode(
    node: WorkflowNode,
    graph: Graph,
    context: ExecutionContext,
    workflowSettings: WorkflowSettings
  ): Promise<boolean> {
    const nodeSettings: NodeSettings = node.settings ?? {};
    const maxRetries = nodeSettings.retries ?? workflowSettings.maxNodeRetries;
    const retryDelay = nodeSettings.retryDelay ?? 1000;
    const retryBackoff = nodeSettings.retryBackoff ?? "fixed";

    // Get module handler
    const handler = this.registry.get(node.type);
    if (!handler) {
      addError(context, {
        nodeId: node.id,
        code: "MODULE_NOT_FOUND",
        message: `Module not found: ${node.type}`,
        retryable: false,
      });
      updateNodeStatus(context, node.id, "failed");
      this.emit({
        type: "node:error",
        nodeId: node.id,
        error: { timestamp: Date.now(), nodeId: node.id, code: "MODULE_NOT_FOUND", message: `Module not found: ${node.type}`, retryable: false },
        willRetry: false,
      });
      return false;
    }

    // Resolve expressions in config
    const expressionContext: ExpressionContext = {
      nodeOutputs: getNodeOutputsMap(context),
      inputs: this.extractInputs(context.variables),
      variables: context.variables,
      env: process.env as Record<string, string | undefined>,
    };

    // Resolve expressions in config (but skip 'code' field to avoid mangling user code)
    const configToResolve = { ...node.data.config };
    const preservedCode = configToResolve.code;
    delete configToResolve.code;

    const resolvedConfig = resolveExpressionsDeep(configToResolve, expressionContext) as Record<string, unknown>;

    // Restore code field without expression resolution
    if (preservedCode !== undefined) {
      resolvedConfig.code = preservedCode;
    }

    // Resolve credential references — replace { __credentialRef: true, credentialId, field? }
    // markers in config with the decrypted credential values.
    // Note: this happens AFTER expression resolution and BEFORE execute, so the
    // resolved secrets are scoped to this single invocation.
    try {
      await this.resolveCredentials(resolvedConfig, context, node.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addError(context, {
        nodeId: node.id,
        code: "CREDENTIAL_ERROR",
        message,
        stack: error instanceof Error ? error.stack : undefined,
        retryable: false,
      });
      updateNodeStatus(context, node.id, "failed");
      this.emit({
        type: "node:error",
        nodeId: node.id,
        error: {
          timestamp: Date.now(),
          nodeId: node.id,
          code: "CREDENTIAL_ERROR",
          message,
          retryable: false,
        },
        willRetry: false,
      });
      return false;
    }

    // Collect inputs from upstream edges
    const inputs = this.collectNodeInputs(node, graph, context, expressionContext);

    // Zod validation — if the module declares configZod / inputsZod, run schema
    // checks BEFORE we enter the retry loop. Validation errors are not retryable.
    let validatedConfig = resolvedConfig;
    let validatedInputs = inputs;
    if (handler.configZod && isZodSchema(handler.configZod)) {
      const result = validateWithZod(handler.configZod, resolvedConfig);
      if (!result.ok) {
        const message = `Config validation failed: ${formatValidationErrors(result.errors)}`;
        addError(context, {
          nodeId: node.id,
          code: "CONFIG_VALIDATION_ERROR",
          message,
          retryable: false,
        });
        updateNodeStatus(context, node.id, "failed");
        this.emit({
          type: "node:error",
          nodeId: node.id,
          error: { timestamp: Date.now(), nodeId: node.id, code: "CONFIG_VALIDATION_ERROR", message, retryable: false },
          willRetry: false,
        });
        return false;
      }
      validatedConfig = result.data as Record<string, unknown>;
    }
    if (handler.inputsZod && isZodSchema(handler.inputsZod)) {
      const result = validateWithZod(handler.inputsZod, inputs);
      if (!result.ok) {
        const message = `Input validation failed: ${formatValidationErrors(result.errors)}`;
        addError(context, {
          nodeId: node.id,
          code: "INPUT_VALIDATION_ERROR",
          message,
          retryable: false,
        });
        updateNodeStatus(context, node.id, "failed");
        this.emit({
          type: "node:error",
          nodeId: node.id,
          error: { timestamp: Date.now(), nodeId: node.id, code: "INPUT_VALIDATION_ERROR", message, retryable: false },
          willRetry: false,
        });
        return false;
      }
      validatedInputs = result.data as Record<string, unknown>;
    }

    // Execute with retry logic
    let attempt = 0;
    while (attempt <= maxRetries) {
      const state = context.nodeStates.get(node.id)!;
      state.retryCount = attempt;

      updateNodeStatus(context, node.id, "running");
      this.emit({ type: "node:start", nodeId: node.id, timestamp: Date.now() });

      try {
        // Apply timeout
        const timeout = nodeSettings.timeout ?? workflowSettings.maxExecutionTime;
        const output = await this.executeWithTimeout(
          handler.execute(validatedInputs, validatedConfig, context),
          timeout
        );

        updateNodeStatus(context, node.id, "completed", output);
        const duration = (state.endTime ?? Date.now()) - (state.startTime ?? Date.now());
        this.emit({ type: "node:complete", nodeId: node.id, output, duration });

        addLog(context, {
          nodeId: node.id,
          level: "info",
          message: `Node completed in ${duration}ms`,
        });

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const willRetry = attempt < maxRetries;

        addError(context, {
          nodeId: node.id,
          code: "EXECUTION_ERROR",
          message,
          stack: error instanceof Error ? error.stack : undefined,
          retryable: willRetry,
        });

        this.emit({
          type: "node:error",
          nodeId: node.id,
          error: { timestamp: Date.now(), nodeId: node.id, code: "EXECUTION_ERROR", message, retryable: willRetry },
          willRetry,
        });

        if (willRetry) {
          const delay = retryBackoff === "exponential"
            ? retryDelay * Math.pow(2, attempt)
            : retryDelay;
          addLog(context, {
            nodeId: node.id,
            level: "warn",
            message: `Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
          });
          await this.sleep(delay);
        }

        attempt++;
      }
    }

    // All retries exhausted
    updateNodeStatus(context, node.id, "failed");
    return false;
  }

  private collectNodeInputs(
    node: WorkflowNode,
    graph: Graph,
    _context: ExecutionContext,
    exprContext: ExpressionContext
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};

    // Include workflow-level inputs (available to all nodes)
    for (const [key, value] of Object.entries(exprContext.inputs)) {
      inputs[key] = value;
    }

    // Resolve inputs from connected edges
    const graphNode = graph.nodes.get(node.id);
    if (graphNode) {
      for (const edge of graphNode.inEdges) {
        const sourceOutput = exprContext.nodeOutputs.get(edge.source);
        if (sourceOutput !== undefined && typeof sourceOutput === "object" && sourceOutput !== null) {
          // Get the specific port value from the source node's output
          const portValue = (sourceOutput as Record<string, unknown>)[edge.sourceHandle];
          if (portValue !== undefined) {
            inputs[edge.targetHandle] = portValue;
          }
        }
      }
    }

    return inputs;
  }

  /**
   * Walk the resolved config tree and replace any CredentialRef markers with
   * their decrypted values. Mutates `value` in place. The decrypted material
   * exists only within this single execute() call's stack frames.
   */
  private async resolveCredentials(
    value: unknown,
    context: ExecutionContext,
    nodeId: string
  ): Promise<void> {
    if (!value || typeof value !== "object") return;

    const store = context.credentials;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (isCredentialRef(item)) {
          value[i] = await this.materializeCredential(item, store, nodeId);
        } else if (item !== null && typeof item === "object") {
          await this.resolveCredentials(item, context, nodeId);
        }
      }
      return;
    }

    // Don't recurse into the marker itself
    if (isCredentialRef(value)) return;

    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      if (isCredentialRef(child)) {
        obj[key] = await this.materializeCredential(child, store, nodeId);
      } else if (child !== null && typeof child === "object") {
        await this.resolveCredentials(child, context, nodeId);
      }
    }
  }

  private async materializeCredential(
    ref: CredentialRef,
    store: ExecutionContext["credentials"],
    nodeId: string
  ): Promise<unknown> {
    if (!store) {
      throw new Error(
        `Node "${nodeId}" references credential "${ref.credentialId}" but no credential store ` +
        `was provided. Pass options.credentials to engine.execute().`
      );
    }
    const payload = await store.resolve(ref);
    if (ref.field) {
      const v = payload[ref.field];
      if (v === undefined) {
        throw new Error(
          `Credential "${ref.credentialId}" has no field "${ref.field}". ` +
          `Available fields: ${Object.keys(payload).join(", ")}`
        );
      }
      return v;
    }
    return payload;
  }

  private extractInputs(variables: Record<string, unknown>): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (key.startsWith("input.")) {
        inputs[key.slice(6)] = value;
      }
    }
    return inputs;
  }

  private collectFinalOutputs(graph: Graph, context: ExecutionContext): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    // Collect outputs from terminal nodes (nodes with no outgoing edges)
    for (const [id, graphNode] of graph.nodes) {
      if (graphNode.outEdges.length === 0) {
        const state = context.nodeStates.get(id);
        if (state?.output !== undefined) {
          outputs[id] = state.output;
        }
      }
    }
    return outputs;
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
