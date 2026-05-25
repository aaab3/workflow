/**
 * Execution context management.
 */

import { v7 as uuidv7 } from "uuid";
import type {
  ExecutionContext,
  ExecutionStatus,
  LogEntry,
  ErrorEntry,
  NodeExecutionState,
  NodeExecutionStatus,
  Workflow,
} from "./types.js";

export function createExecutionContext(
  workflow: Workflow,
  inputs?: Record<string, unknown>,
  executionId?: string
): ExecutionContext {
  const nodeStates = new Map<string, NodeExecutionState>();

  for (const node of workflow.nodes) {
    nodeStates.set(node.id, {
      status: "pending",
      retryCount: 0,
    });
  }

  // Initialize variables with defaults
  const variables: Record<string, unknown> = {};
  for (const varDef of workflow.variables ?? []) {
    variables[varDef.name] = varDef.defaultValue;
  }

  // Merge workflow inputs into variables under "input" namespace
  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      variables[`input.${key}`] = value;
    }
  }

  return {
    workflowId: workflow.id,
    executionId: executionId ?? uuidv7(),
    status: "pending",
    startTime: Date.now(),
    nodeStates,
    variables,
    logs: [],
    errors: [],
    metrics: {
      totalNodes: workflow.nodes.length,
      completedNodes: 0,
      failedNodes: 0,
      skippedNodes: 0,
    },
  };
}

export function updateNodeStatus(
  context: ExecutionContext,
  nodeId: string,
  status: NodeExecutionStatus,
  output?: unknown
): void {
  const state = context.nodeStates.get(nodeId);
  if (!state) return;

  state.status = status;

  if (status === "running") {
    state.startTime = Date.now();
  }

  if (status === "completed" || status === "failed" || status === "skipped") {
    state.endTime = Date.now();
  }

  if (status === "completed" && output !== undefined) {
    state.output = output;
    context.metrics.completedNodes++;
  }

  if (status === "failed") {
    context.metrics.failedNodes++;
  }

  if (status === "skipped") {
    context.metrics.skippedNodes++;
  }
}

export function setExecutionStatus(context: ExecutionContext, status: ExecutionStatus): void {
  context.status = status;
  if (status === "completed" || status === "failed" || status === "cancelled") {
    context.endTime = Date.now();
    context.metrics.totalDuration = context.endTime - context.startTime;
  }
}

export function addLog(context: ExecutionContext, entry: Omit<LogEntry, "timestamp">): void {
  context.logs.push({
    ...entry,
    timestamp: Date.now(),
  });
}

export function addError(context: ExecutionContext, entry: Omit<ErrorEntry, "timestamp">): void {
  context.errors.push({
    ...entry,
    timestamp: Date.now(),
  });
}

/**
 * Collect all node outputs as a flat map for expression resolution.
 */
export function getNodeOutputsMap(context: ExecutionContext): Map<string, unknown> {
  const outputs = new Map<string, unknown>();
  for (const [nodeId, state] of context.nodeStates) {
    if (state.status === "completed" && state.output !== undefined) {
      outputs.set(nodeId, state.output);
    }
  }
  return outputs;
}
