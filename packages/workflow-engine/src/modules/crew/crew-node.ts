/**
 * crew node module — Integrates the Multi-Agent Crew framework as a workflow node.
 *
 * This node allows users to define a team of agents, choose a collaboration mode,
 * and execute multi-agent workflows as a single step in the larger workflow.
 */

import { CrewEngine } from "../../crew/index.js";
import type { CrewDef, AgentDef, CrewMode } from "../../crew/types.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

export const crewModule: ModuleHandler = {
  meta: {
    id: "crew",
    name: "多Agent协作",
    category: "llm",
    description: "多Agent团队协作节点：支持流水线、并行、辩论、反思、层级等模式",
    icon: "users",
    inputs: [
      { id: "task", name: "任务描述", type: "string" },
      { id: "data", name: "输入数据", type: "any" },
    ],
    outputs: [
      { id: "result", name: "最终结果", type: "any" },
      { id: "messages", name: "协作消息", type: "array" },
      { id: "metrics", name: "执行指标", type: "object" },
    ],
    configSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["auto", "solo", "pipeline", "parallel", "reflect", "moa", "debate", "hierarchy"],
          default: "auto",
          description: "协作模式",
        },
        agents: {
          type: "array",
          description: "Agent 定义列表（JSON 数组）",
        },
        contextStrategy: {
          type: "string",
          enum: ["shared", "isolated", "selective"],
          default: "shared",
          description: "上下文共享策略",
        },
        maxRounds: {
          type: "number",
          default: 3,
          description: "最大轮次（辩论/反思模式）",
        },
        qualityThreshold: {
          type: "number",
          default: 7,
          description: "质量阈值（1-10，反思模式）",
        },
        maxTokens: {
          type: "number",
          default: 100000,
          description: "总 Token 预算",
        },
      },
      required: ["mode", "agents"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const task = (inputs.task as string) ?? (config.task as string) ?? "Complete the assigned task";
    const inputData = (inputs.data as Record<string, unknown>) ?? {};
    const mode = (config.mode as CrewMode) ?? "auto";
    const contextStrategy = (config.contextStrategy as string) ?? "shared";
    const maxRounds = (config.maxRounds as number) ?? 3;
    const qualityThreshold = (config.qualityThreshold as number) ?? 7;
    const maxTokens = (config.maxTokens as number) ?? 100000;

    // Parse agents from config
    let agents: AgentDef[];
    if (Array.isArray(config.agents)) {
      agents = (config.agents as AgentDef[]).map((a, i) => normalizeAgent(a, i, contextStrategy));
    } else if (typeof config.agents === "string") {
      try {
        agents = (JSON.parse(config.agents) as AgentDef[]).map((a, i) => normalizeAgent(a, i, contextStrategy));
      } catch {
        throw new Error("agents 配置格式错误，需要 JSON 数组");
      }
    } else {
      throw new Error("agents 配置缺失");
    }

    if (agents.length === 0) {
      throw new Error("至少需要一个 Agent");
    }

    // Build crew definition
    const crewDef: CrewDef = {
      id: `crew-${Date.now()}`,
      task,
      mode,
      agents,
      context: { strategy: contextStrategy as "shared" | "isolated" | "selective" },
      budget: { maxTokens },
      termination: {
        condition: mode === "reflect" ? "quality" : mode === "debate" ? "rounds" : "rounds",
        maxRounds,
        qualityThreshold,
      },
    };

    // Execute
    const engine = new CrewEngine();
    const execution = await engine.execute(crewDef, inputData);

    if (execution.status === "failed") {
      const lastError = Array.from(execution.agentStates.values()).find((s) => s.lastError)?.lastError;
      throw new Error(`Crew 执行失败: ${lastError ?? "unknown error"}`);
    }

    return {
      result: execution.finalOutput,
      messages: execution.messages.map((m) => ({
        from: m.from,
        to: m.to,
        type: m.type,
        content: m.content.slice(0, 500),
        round: m.round,
      })),
      metrics: {
        totalTokens: execution.metrics.totalTokens,
        totalRounds: execution.round,
        duration: execution.metrics.duration,
        agentTokens: execution.metrics.agentTokens,
      },
    };
  },
};

function normalizeAgent(raw: Partial<AgentDef>, index: number, defaultContext: string): AgentDef {
  return {
    id: raw.id ?? `agent-${index}`,
    role: raw.role ?? `Agent ${index + 1}`,
    model: raw.model ?? { name: "gpt-4o-mini" },
    systemPrompt: raw.systemPrompt ?? `你是一个${raw.role ?? "助手"}。`,
    tools: raw.tools,
    context: raw.context ?? { mode: defaultContext as "shared" | "isolated" | "selective" },
    behavior: raw.behavior ?? {},
    inputs: raw.inputs,
    outputs: raw.outputs,
  };
}
