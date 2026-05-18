/**
 * Multi-Agent Crew Framework — Type Definitions
 *
 * Core concepts:
 * - Agent: An LLM with a role, model, prompt, and behavior config
 * - Crew: A group of agents collaborating on a task
 * - Flow: How data/control moves between agents
 * - Context: What each agent can see (shared/isolated/selective)
 */

// ─── Agent Definition ───────────────────────────────────────────────────────

export interface AgentDef {
  id: string;
  role: string;
  /** Explicit role type for mode-specific behavior (replaces array position convention) */
  roleType?: AgentRoleType;
  model: ModelConfig;
  systemPrompt: string;
  tools?: string[];                    // Available tool IDs
  context: ContextConfig;
  behavior: BehaviorConfig;
  inputs?: string[];                   // Expected input field names
  outputs?: string[];                  // Produced output field names
}

/** Explicit role types for structured agent assignment */
export type AgentRoleType =
  | "worker"       // General worker agent
  | "dispatcher"   // Splits tasks for parallel execution
  | "merger"       // Combines results from workers
  | "lead"         // Team lead in hierarchy mode
  | "reviewer"     // Quality reviewer in reflect mode
  | "judge"        // Final arbiter in debate mode
  | "proposer"     // Proposes answers in MoA mode
  | "aggregator";  // Synthesizes proposals in MoA mode

export interface ModelConfig {
  provider?: string;                   // "openai" | "anthropic" | "ollama" | etc
  name: string;                        // "gpt-4o" | "gpt-4o-mini" | "claude-3-sonnet"
  baseUrl?: string;                    // Custom API endpoint
  apiKey?: string;                     // Or use env var
  temperature?: number;
  maxTokens?: number;
}

export interface ContextConfig {
  mode: "shared" | "isolated" | "selective" | "inherit";
  shareWith?: string[];                // For selective mode
  maxTokens?: number;                  // Context budget per agent
  includeHistory?: boolean;            // Include conversation history
}

export interface BehaviorConfig {
  canDelegate?: boolean;               // Can assign tasks to others
  canEscalate?: boolean;               // Can escalate to human
  maxRetries?: number;
  confidenceThreshold?: number;        // 0-1, below triggers retry
  timeout?: number;                    // ms
}

// ─── Crew Definition ────────────────────────────────────────────────────────

export interface CrewDef {
  id: string;
  name?: string;
  task: string;                        // High-level task description
  mode: CrewMode;
  agents: AgentDef[];
  flow?: FlowDef[];                    // Data/control flow between agents
  context?: CrewContextConfig;
  budget?: BudgetConfig;
  termination?: TerminationConfig;
  /** Error handling strategy */
  errorStrategy?: CrewErrorStrategy;
  /** Locale for built-in prompts (default: "zh") */
  locale?: "zh" | "en";
  /** Custom prompt overrides (keyed by prompt ID) */
  promptOverrides?: Record<string, string>;
}

export type CrewErrorStrategy = "fail-fast" | "continue" | "skip-agent";

export type CrewMode =
  | "solo"          // Single agent
  | "pipeline"     // Sequential A→B→C
  | "parallel"     // Independent, merge results
  | "moa"          // Mixture-of-Agents (vote/aggregate)
  | "debate"       // Adversarial discussion
  | "hierarchy"    // Lead delegates to workers
  | "reflect"      // Generate → self-check → revise
  | "auto";        // AI decides which mode

export interface FlowDef {
  from: string;                        // Source agent ID
  to: string;                          // Target agent ID
  data?: string;                       // Which output field to pass
  condition?: string;                  // Conditional routing expression
  type?: "data" | "control" | "debate"; // Connection type
}

export interface CrewContextConfig {
  strategy: "shared" | "isolated" | "selective";
  blackboard?: Record<string, unknown>; // Initial shared state
}

export interface BudgetConfig {
  maxTokens?: number;                  // Total token budget
  maxCost?: number;                    // Max cost in USD
  maxDuration?: number;                // Max time in ms
}

export interface TerminationConfig {
  condition: "rounds" | "quality" | "consensus" | "lead_decision" | "budget";
  maxRounds?: number;
  qualityField?: string;               // Which output field to check
  qualityThreshold?: number;           // Min score to pass
}

// ─── Execution State ────────────────────────────────────────────────────────

export interface CrewExecution {
  crewId: string;
  executionId: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  round: number;
  agentStates: Map<string, AgentState>;
  blackboard: Record<string, unknown>;  // Shared state
  messages: CrewMessage[];
  metrics: CrewMetrics;
  finalOutput?: unknown;
}

export interface AgentState {
  agentId: string;
  status: "idle" | "thinking" | "done" | "failed";
  output?: unknown;
  tokenUsage: number;
  rounds: number;
  lastError?: string;
}

export interface CrewMessage {
  id: string;
  from: string;
  to: string | "blackboard" | "all";
  type: "task" | "result" | "feedback" | "critique" | "decision" | "escalate";
  content: string;
  data?: unknown;
  timestamp: number;
  round: number;
}

export interface CrewMetrics {
  totalTokens: number;
  totalCost: number;
  totalRounds: number;
  agentTokens: Record<string, number>;
  duration: number;
}

// ─── Events ─────────────────────────────────────────────────────────────────

export type CrewEvent =
  | { type: "crew:start"; crewId: string; mode: CrewMode; timestamp: number }
  | { type: "agent:start"; agentId: string; role: string; round: number; timestamp: number }
  | { type: "agent:thinking"; agentId: string; content: string; timestamp: number }
  | { type: "agent:done"; agentId: string; output: unknown; tokens: number; timestamp: number }
  | { type: "agent:error"; agentId: string; error: string; timestamp: number }
  | { type: "message"; message: CrewMessage }
  | { type: "blackboard:update"; key: string; value: unknown; by: string; timestamp: number }
  | { type: "round:complete"; round: number; timestamp: number }
  | { type: "crew:complete"; output: unknown; metrics: CrewMetrics; timestamp: number }
  | { type: "crew:error"; error: string; timestamp: number };
