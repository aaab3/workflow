/**
 * @openclaw/workflow-engine
 *
 * OpenClaw Workflow - Universal workflow execution engine.
 * Supports sequential, parallel, conditional, and loop execution patterns.
 * Works with any AI Agent via MCP, A2A, CLI, or HTTP protocols.
 */

// Core engine
export { WorkflowEngine } from "./engine.js";
export type { EngineOptions, EventListener } from "./engine.js";

// Graph utilities
export { buildGraph, getUpstreamNodes, getDownstreamNodes, GraphValidationError } from "./graph.js";
export type { Graph, GraphNode } from "./graph.js";

// Execution context
export {
  createExecutionContext,
  updateNodeStatus,
  setExecutionStatus,
  addLog,
  addError,
  getNodeOutputsMap,
} from "./context.js";

// Expression system
export { resolveExpressions, resolveExpressionsDeep } from "./expression.js";
export type { ExpressionContext } from "./expression.js";

// Module registry
export { ModuleRegistry } from "./module-registry.js";
export { createDefaultRegistry } from "./shared-registry.js";

// Built-in modules
export {
  fileReadModule,
  fileWriteModule,
  httpRequestModule,
  textInputModule,
  terminalModule,
  javascriptModule,
  conditionModule,
  delayModule,
  loopModule,
  llmChatModule,
  llmStructuredModule,
  crewModule,
  dataTransformModule,
  toolCacheModule,
} from "./modules/index.js";

// Types
export type {
  Workflow,
  WorkflowSettings,
  WorkflowNode,
  WorkflowEdge,
  NodeSettings,
  PortDef,
  PortType,
  VariableDef,
  Trigger,
  ExecutionContext,
  ExecutionStatus,
  NodeExecutionState,
  NodeExecutionStatus,
  ExecutionMetrics,
  LogEntry,
  ErrorEntry,
  ModuleHandler,
  ModuleMeta,
  ModuleCategory,
  ValidationResult,
  EngineEvent,
} from "./types.js";

// Multi-Agent Crew Framework
export { CrewEngine } from "./crew/index.js";
export type {
  CrewEventListener,
  CrewExecuteOptions,
  AgentRunInput,
  AgentRunOutput,
  AgentDef,
  AgentRoleType,
  ModelConfig,
  ContextConfig,
  BehaviorConfig,
  CrewDef,
  CrewMode,
  CrewErrorStrategy,
  FlowDef,
  CrewContextConfig,
  BudgetConfig,
  TerminationConfig,
  CrewExecution,
  AgentState,
  CrewMessage,
  CrewMetrics,
  CrewEvent,
  PromptLocale,
  PromptTemplates,
} from "./crew/index.js";
export { getPrompt, resolvePrompt } from "./crew/index.js";

// Module schema utilities (Zod ↔ JSON Schema bridge)
export {
  isZodSchema,
  zodToConfigSchema,
  validateWithZod,
  formatValidationErrors,
  credentialField,
  credentialRefSchema,
} from "./module-schema.js";
export type { ValidationOk, ValidationFail } from "./module-schema.js";

// CLI discovery (terminal app picker)
export { detectCliApps, CLI_APP_PRESETS } from "./cli-detect.js";
export type { CliAppPreset, DetectedCliApp, CliAppCategory } from "./cli-detect.js";

// Security
export {
  createDefaultSecurityConfig,
  createWorkflowServerSecurityConfig,
  validateFilePath,
  validateUrl,
  validateCommand,
  SecurityError,
} from "./security.js";
export type {
  SecurityConfig,
  FilesystemPolicy,
  NetworkPolicy,
  CodePolicy,
  TerminalPolicy,
} from "./security.js";

// Credentials
export {
  encryptPayload,
  decryptPayload,
  isCredentialRef,
  makeCredentialRef,
  CredentialError,
  safeEqual,
} from "./credentials.js";
export type {
  CredentialRecord,
  CredentialRef,
  CredentialPayload,
  CredentialSummary,
  CredentialStore,
} from "./credentials.js";
