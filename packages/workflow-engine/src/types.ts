/**
 * OpenClaw Workflow Engine - Core Type Definitions
 */

// ─── Workflow Definition ────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: VariableDef[];
  triggers: Trigger[];
  settings: WorkflowSettings;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSettings {
  maxExecutionTime: number;
  maxNodeRetries: number;
  errorStrategy: ErrorStrategy;
  concurrencyLimit: number;
}

export type ErrorStrategy = "fail-fast" | "continue" | "pause";

export interface VariableDef {
  name: string;
  type: PortType;
  defaultValue?: unknown;
  description?: string;
}

// ─── Node ───────────────────────────────────────────────────────────────────

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    config: Record<string, unknown>;
    inputs: PortDef[];
    outputs: PortDef[];
  };
  settings?: NodeSettings;
}

export interface NodeSettings {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  retryBackoff?: "fixed" | "exponential";
  continueOnError?: boolean;
  notes?: string;
}

export interface PortDef {
  id: string;
  name: string;
  type: PortType;
  required?: boolean;
  description?: string;
}

export type PortType = "string" | "number" | "boolean" | "object" | "array" | "any";

// ─── Edge ───────────────────────────────────────────────────────────────────

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  condition?: string;
}

// ─── Trigger ────────────────────────────────────────────────────────────────

export interface Trigger {
  type: "manual" | "cron" | "webhook" | "file-watch" | "event";
  enabled: boolean;
  config: Record<string, unknown>;
}

// ─── Execution Context ──────────────────────────────────────────────────────

export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  status: ExecutionStatus;
  startTime: number;
  endTime?: number;
  nodeStates: Map<string, NodeExecutionState>;
  variables: Record<string, unknown>;
  logs: LogEntry[];
  errors: ErrorEntry[];
  metrics: ExecutionMetrics;
  /** Security configuration for module access control */
  security?: import("./security.js").SecurityConfig;
  /** Credential store — modules call .resolve(ref) to get decrypted secrets */
  credentials?: import("./credentials.js").CredentialStore;
}

export interface NodeExecutionState {
  status: NodeExecutionStatus;
  output?: unknown;
  outputRef?: string;
  startTime?: number;
  endTime?: number;
  retryCount: number;
  error?: ErrorEntry;
}

export interface ExecutionMetrics {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  totalDuration?: number;
}

export interface LogEntry {
  timestamp: number;
  nodeId?: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

export interface ErrorEntry {
  timestamp: number;
  nodeId: string;
  code: string;
  message: string;
  stack?: string;
  retryable: boolean;
}

// ─── Module Handler ─────────────────────────────────────────────────────────

export type ModuleCategory = "llm" | "data" | "io" | "flow" | "code" | "tool";

export interface ModuleMeta {
  id: string;
  name: string;
  category: ModuleCategory;
  description: string;
  icon: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /**
   * JSON Schema 7 for the config. Either this OR `configZod` (in the
   * ModuleHandler) must be present. If `configZod` is present, the engine
   * derives JSON Schema from it automatically and ignores this field.
   */
  configSchema: Record<string, unknown>;
  /** Module version, used for migration when configSchema changes. */
  version?: string;
}

export interface ModuleHandler {
  meta: ModuleMeta;

  /**
   * Optional Zod schema for runtime validation of config. When present, the
   * engine uses this to safeParse() config before execute(), applying defaults
   * and rejecting invalid input with a structured error.
   *
   * Use `import { z } from "zod"` to define this in your module file.
   * Type: ZodType — duck-typed at runtime so it works across packages.
   */
  configZod?: unknown;

  /** Optional Zod schema for inputs (data flowing in via edges). */
  inputsZod?: unknown;

  /** Optional Zod schema for outputs (used by tests / future MCP exposure). */
  outputsZod?: unknown;

  execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>>;

  /** Legacy validate hook — runs after Zod validation if both are present. */
  validate?(config: Record<string, unknown>): ValidationResult;

  /** Optional initialization hook (called once on registration). */
  init?(): Promise<void>;

  /** Optional cleanup hook (called on registry dispose). */
  dispose?(): Promise<void>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{ path: string; message: string }>;
}

// ─── Engine Events ──────────────────────────────────────────────────────────

export type EngineEvent =
  | { type: "execution:start"; executionId: string; timestamp: number }
  | { type: "node:start"; nodeId: string; timestamp: number }
  | { type: "node:complete"; nodeId: string; output: unknown; duration: number }
  | { type: "node:error"; nodeId: string; error: ErrorEntry; willRetry: boolean }
  | { type: "node:skip"; nodeId: string; reason: string }
  | { type: "execution:complete"; outputs: Record<string, unknown>; duration: number; metrics: ExecutionMetrics }
  | { type: "execution:error"; message: string; nodeId?: string; fatal: boolean }
  | { type: "execution:paused"; nodeId: string; reason: string }
  | { type: "log"; nodeId?: string; level: LogEntry["level"]; message: string; timestamp: number };
