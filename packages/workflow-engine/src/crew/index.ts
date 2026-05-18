/**
 * Multi-Agent Crew Framework
 *
 * Usage:
 *   const engine = new CrewEngine();
 *   engine.on(event => console.log(event));
 *   const result = await engine.execute(crewDef, { input: "data" }, { signal });
 */

export { CrewEngine } from "./crew-engine.js";
export type { CrewEventListener, CrewExecuteOptions } from "./crew-engine.js";
export { runAgent } from "./agent-runner.js";
export type { AgentRunInput, AgentRunOutput } from "./agent-runner.js";
export { getPrompt, resolvePrompt } from "./prompts.js";
export type { PromptLocale, PromptTemplates } from "./prompts.js";
export type {
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
} from "./types.js";
