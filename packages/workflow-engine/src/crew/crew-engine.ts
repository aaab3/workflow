/**
 * Crew Engine — Orchestrates multi-agent collaboration.
 *
 * Improvements over v1:
 * - Explicit roleType-based agent lookup (no more array position convention)
 * - Internationalized prompt templates (zh/en)
 * - AbortSignal support for cancellation
 * - Error strategy: fail-fast / continue / skip-agent
 * - FlowDef-aware pipeline routing
 */

import { v7 as uuidv7 } from "uuid";
import { runAgent, type AgentRunInput } from "./agent-runner.js";
import { getPrompt, resolvePrompt, type PromptLocale } from "./prompts.js";
import type {
  CrewDef,
  CrewExecution,
  CrewEvent,
  CrewMessage,
  AgentDef,
  AgentState,
  AgentRoleType,
  CrewErrorStrategy,
} from "./types.js";

export type CrewEventListener = (event: CrewEvent) => void;

export interface CrewExecuteOptions {
  signal?: AbortSignal;
}

export class CrewEngine {
  private listeners: CrewEventListener[] = [];

  on(listener: CrewEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: CrewEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  async execute(crew: CrewDef, input?: Record<string, unknown>, options?: CrewExecuteOptions): Promise<CrewExecution> {
    const execution = this.createExecution(crew);
    execution.blackboard = { ...crew.context?.blackboard, ...input };
    const signal = options?.signal;

    this.emit({ type: "crew:start", crewId: crew.id, mode: crew.mode, timestamp: Date.now() });

    try {
      this.checkAborted(signal);

      switch (crew.mode) {
        case "solo":
          await this.executeSolo(crew, execution, signal);
          break;
        case "pipeline":
          await this.executePipeline(crew, execution, signal);
          break;
        case "parallel":
          await this.executeParallel(crew, execution, signal);
          break;
        case "reflect":
          await this.executeReflect(crew, execution, signal);
          break;
        case "moa":
          await this.executeMoA(crew, execution, signal);
          break;
        case "debate":
          await this.executeDebate(crew, execution, signal);
          break;
        case "hierarchy":
          await this.executeHierarchy(crew, execution, signal);
          break;
        case "auto":
          await this.executeAuto(crew, execution, signal);
          break;
      }

      execution.status = "completed";
      execution.endTime = Date.now();
      execution.metrics.duration = execution.endTime - execution.startTime;
      this.emit({ type: "crew:complete", output: execution.finalOutput, metrics: execution.metrics, timestamp: Date.now() });
    } catch (error) {
      if (signal?.aborted) {
        execution.status = "cancelled" as any;
      } else {
        execution.status = "failed";
      }
      execution.endTime = Date.now();
      execution.metrics.duration = execution.endTime - execution.startTime;
      this.emit({ type: "crew:error", error: error instanceof Error ? error.message : String(error), timestamp: Date.now() });
    }

    return execution;
  }

  // ─── Agent Lookup by RoleType ───────────────────────────────────────────

  private findAgentByRole(crew: CrewDef, roleType: AgentRoleType, fallbackIndex?: number): AgentDef | undefined {
    const found = crew.agents.find(a => a.roleType === roleType);
    if (found) return found;
    // Fallback to array position for backward compatibility
    if (fallbackIndex !== undefined && fallbackIndex < crew.agents.length) {
      return crew.agents[fallbackIndex];
    }
    return undefined;
  }

  private getLocale(crew: CrewDef): PromptLocale {
    return crew.locale ?? "zh";
  }

  private checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Crew execution was cancelled");
    }
  }

  // ─── Solo Mode ──────────────────────────────────────────────────────────

  private async executeSolo(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    const agent = crew.agents[0]!;
    const result = await this.runAgentWithTracking(agent, exec, { task: crew.task, data: exec.blackboard }, crew, signal);
    exec.finalOutput = result.data ?? result.content;
  }

  // ─── Pipeline Mode ──────────────────────────────────────────────────────

  private async executePipeline(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    const locale = this.getLocale(crew);
    let currentData: Record<string, unknown> = { ...exec.blackboard };

    // Determine execution order: use FlowDef if available, otherwise array order
    const orderedAgents = this.getPipelineOrder(crew);

    for (let i = 0; i < orderedAgents.length; i++) {
      this.checkAborted(signal);
      const agent = orderedAgents[i]!;
      const isFirst = i === 0;
      const prevOutput = isFirst ? null : currentData[`${orderedAgents[i - 1]!.id}_output`];

      let task: string;
      if (!isFirst && prevOutput) {
        task = resolvePrompt(getPrompt("pipeline_subsequent_task", locale, crew.promptOverrides), {
          prevOutput: String(prevOutput).slice(0, 1500),
          agentTask: agent.systemPrompt || crew.task,
        });
      } else {
        task = resolvePrompt(getPrompt("pipeline_first_task", locale, crew.promptOverrides), { task: crew.task });
      }

      const result = await this.runAgentWithTracking(agent, exec, {
        task,
        data: currentData,
        history: this.getVisibleMessages(agent, exec),
        blackboard: agent.context.mode === "shared" ? exec.blackboard : undefined,
      }, crew, signal);

      if (result.data) {
        Object.assign(exec.blackboard, result.data);
        currentData = { ...currentData, ...result.data, [`${agent.id}_output`]: result.content };
      } else {
        currentData[`${agent.id}_output`] = result.content;
      }
    }

    exec.finalOutput = currentData;
  }

  private getPipelineOrder(crew: CrewDef): AgentDef[] {
    if (!crew.flow || crew.flow.length === 0) return crew.agents;

    // Build order from FlowDef
    const agentMap = new Map(crew.agents.map(a => [a.id, a]));
    const ordered: AgentDef[] = [];
    const visited = new Set<string>();

    // Find the starting agent (one that is not a target in any flow)
    const targets = new Set(crew.flow.map(f => f.to));
    const startId = crew.agents.find(a => !targets.has(a.id))?.id ?? crew.agents[0]!.id;

    let currentId: string | undefined = startId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const agent = agentMap.get(currentId);
      if (agent) ordered.push(agent);
      const nextFlow = crew.flow.find(f => f.from === currentId);
      currentId = nextFlow?.to;
    }

    // Add any agents not in the flow (fallback)
    for (const agent of crew.agents) {
      if (!visited.has(agent.id)) ordered.push(agent);
    }

    return ordered;
  }

  // ─── Parallel Mode ──────────────────────────────────────────────────────

  private async executeParallel(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    const locale = this.getLocale(crew);
    const errorStrategy = crew.errorStrategy ?? "fail-fast";

    // Find agents by roleType (with fallback to array position convention)
    const dispatcher = this.findAgentByRole(crew, "dispatcher");
    const merger = this.findAgentByRole(crew, "merger");
    const explicitWorkers = crew.agents.filter(a => a.roleType === "worker");

    // Determine if we should use simple parallel or dispatcher/merger pattern
    const hasExplicitRoles = dispatcher || merger || explicitWorkers.length > 0;

    // Simple case: no explicit roles and <= 2 agents, OR all agents are workers
    if (!hasExplicitRoles || crew.agents.length <= 2) {
      const results = await this.runParallelWithStrategy(
        crew.agents,
        (agent) => this.runAgentWithTracking(agent, exec, {
          task: resolvePrompt(getPrompt("parallel_task", locale, crew.promptOverrides), { task: crew.task }),
          data: exec.blackboard,
        }, crew, signal),
        errorStrategy
      );

      const combined: Record<string, unknown> = {};
      for (const { agent, result } of results) {
        if (result) combined[agent.id] = result.data ?? result.content;
      }
      exec.finalOutput = combined;
      return;
    }

    // Full parallel: dispatcher → workers → merger
    // Need both dispatcher and merger for this pattern
    if (!dispatcher || !merger) {
      // Fallback to simple parallel if pattern is incomplete
      const results = await this.runParallelWithStrategy(
        crew.agents,
        (agent) => this.runAgentWithTracking(agent, exec, {
          task: resolvePrompt(getPrompt("parallel_task", locale, crew.promptOverrides), { task: crew.task }),
          data: exec.blackboard,
        }, crew, signal),
        errorStrategy
      );
      const combined: Record<string, unknown> = {};
      for (const { agent, result } of results) {
        if (result) combined[agent.id] = result.data ?? result.content;
      }
      exec.finalOutput = combined;
      return;
    }

    this.checkAborted(signal);

    // Step 1: Dispatcher splits the task
    const actualWorkers = crew.agents.filter(a => a !== dispatcher && a !== merger);
    const dispatchResult = await this.runAgentWithTracking(dispatcher, exec, {
      task: resolvePrompt(getPrompt("parallel_dispatch", locale, crew.promptOverrides), {
        workerCount: actualWorkers.length,
        task: crew.task,
        workers: actualWorkers.map(w => w.role).join("、"),
      }),
      data: exec.blackboard,
    }, crew, signal);

    const subtasks = this.parseSubtasks(dispatchResult.content, actualWorkers, crew.task);

    // Step 2: Workers execute in parallel
    this.checkAborted(signal);
    const workerResults = await this.runParallelWithStrategy(
      subtasks.map(s => s.agent),
      (agent) => {
        const subtask = subtasks.find(s => s.agent.id === agent.id)?.subtask ?? crew.task;
        return this.runAgentWithTracking(agent, exec, {
          task: resolvePrompt(getPrompt("parallel_task", locale, crew.promptOverrides), { task: subtask }),
          data: exec.blackboard,
        }, crew, signal);
      },
      errorStrategy
    );

    // Step 3: Merger combines results
    this.checkAborted(signal);
    const resultsText = workerResults
      .filter(r => r.result)
      .map(r => `[${r.agent.role}]:\n${r.result!.content}`)
      .join("\n\n---\n\n");

    const mergeResult = await this.runAgentWithTracking(merger, exec, {
      task: resolvePrompt(getPrompt("parallel_merge", locale, crew.promptOverrides), {
        task: crew.task,
        results: resultsText,
      }),
      data: exec.blackboard,
    }, crew, signal);

    exec.finalOutput = mergeResult.data ?? mergeResult.content;
  }

  /** Run multiple agents in parallel with error strategy support */
  private async runParallelWithStrategy(
    agents: AgentDef[],
    runFn: (agent: AgentDef) => Promise<{ content: string; data?: Record<string, unknown>; tokenUsage: number }>,
    errorStrategy: CrewErrorStrategy
  ): Promise<Array<{ agent: AgentDef; result: { content: string; data?: Record<string, unknown> } | null; error?: string }>> {
    const results = await Promise.allSettled(agents.map(async (agent) => {
      const result = await runFn(agent);
      return { agent, result };
    }));

    const output: Array<{ agent: AgentDef; result: { content: string; data?: Record<string, unknown> } | null; error?: string }> = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === "fulfilled") {
        output.push({ agent: r.value.agent, result: r.value.result });
      } else {
        const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
        if (errorStrategy === "fail-fast") throw r.reason;
        output.push({ agent: agents[i]!, result: null, error });
      }
    }

    return output;
  }

  // ─── Reflect Mode ───────────────────────────────────────────────────────

  private async executeReflect(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    const locale = this.getLocale(crew);
    const generator = this.findAgentByRole(crew, "worker", 0) ?? crew.agents[0]!;
    const reviewer = this.findAgentByRole(crew, "reviewer", 1) ?? this.createReflector(generator, locale);
    const maxRounds = crew.termination?.maxRounds ?? 3;
    const threshold = crew.termination?.qualityThreshold ?? 7;

    let lastOutput = "";
    let prevOutput = "";
    let score = 0;
    let prevScore = -1;

    for (let round = 0; round < maxRounds; round++) {
      this.checkAborted(signal);
      exec.round = round + 1;

      // Generate
      const genTask = round === 0
        ? resolvePrompt(getPrompt("reflect_generate_first", locale, crew.promptOverrides), { task: crew.task })
        : resolvePrompt(getPrompt("reflect_generate_revise", locale, crew.promptOverrides), {
            lastOutput: lastOutput.slice(0, 1000),
            feedback: String(exec.blackboard._feedback).slice(0, 500),
          });

      const genResult = await this.runAgentWithTracking(generator, exec, {
        task: genTask,
        data: exec.blackboard,
      }, crew, signal);

      prevOutput = lastOutput;
      lastOutput = genResult.content;
      exec.blackboard._lastOutput = lastOutput;

      // Review
      this.checkAborted(signal);
      const reviewResult = await this.runAgentWithTracking(reviewer, exec, {
        task: resolvePrompt(getPrompt("reflect_review", locale, crew.promptOverrides), {
          output: lastOutput.slice(0, 1500),
        }),
        data: { output: lastOutput },
      }, crew, signal);

      score = this.extractScore(reviewResult.content);
      exec.blackboard._feedback = reviewResult.content;
      exec.blackboard._score = score;

      this.emit({ type: "round:complete", round: round + 1, timestamp: Date.now() });

      // Early stopping conditions
      if (score >= threshold) break;
      if (score === prevScore && round > 0) break;
      if (prevOutput && this.textSimilarity(lastOutput, prevOutput) > 0.9) break;

      prevScore = score;
    }

    exec.finalOutput = { content: lastOutput, score, rounds: exec.round };
  }

  // ─── MoA (Mixture-of-Agents) Mode ──────────────────────────────────────

  private async executeMoA(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    const locale = this.getLocale(crew);
    const errorStrategy = crew.errorStrategy ?? "fail-fast";

    // Find proposers and aggregator by roleType
    const aggregator = this.findAgentByRole(crew, "aggregator", crew.agents.length - 1) ?? crew.agents[crew.agents.length - 1]!;
    const proposers = crew.agents.filter(a => a !== aggregator);

    // Phase 1: All proposers answer independently
    this.checkAborted(signal);
    const proposals = await this.runParallelWithStrategy(
      proposers,
      (agent) => this.runAgentWithTracking(agent, exec, { task: crew.task, data: exec.blackboard }, crew, signal),
      errorStrategy
    );

    // Phase 2: Aggregator synthesizes
    this.checkAborted(signal);
    const proposalText = proposals
      .filter(p => p.result)
      .map(p => `[${p.agent.role}]: ${p.result!.content}`)
      .join("\n\n---\n\n");

    const aggregateResult = await this.runAgentWithTracking(aggregator, exec, {
      task: resolvePrompt(getPrompt("moa_aggregate", locale, crew.promptOverrides), { proposals: proposalText }),
      data: exec.blackboard,
    }, crew, signal);

    exec.finalOutput = aggregateResult.data ?? aggregateResult.content;
  }

  // ─── Debate Mode ────────────────────────────────────────────────────────

  private async executeDebate(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    const locale = this.getLocale(crew);
    const maxRounds = crew.termination?.maxRounds ?? 3;

    // Find debaters and judge by roleType
    const judge = this.findAgentByRole(crew, "judge", 2);
    const debaters = crew.agents.filter(a => a !== judge).slice(0, 2);

    let debateHistory: string[] = [];
    let prevRoundContent = "";

    for (let round = 0; round < maxRounds; round++) {
      this.checkAborted(signal);
      exec.round = round + 1;
      let roundContent = "";

      for (let di = 0; di < debaters.length; di++) {
        this.checkAborted(signal);
        const debater = debaters[di]!;
        const opponent = debaters[1 - di];

        const recentHistory = debateHistory.slice(-4);

        let task: string;
        if (debateHistory.length === 0) {
          task = resolvePrompt(getPrompt("debate_opening", locale, crew.promptOverrides), {
            task: crew.task,
            role: debater.role,
          });
        } else {
          task = resolvePrompt(getPrompt("debate_rebuttal", locale, crew.promptOverrides), {
            task: crew.task,
            role: debater.role,
            opponent: opponent?.role ?? "opponent",
            recentHistory: recentHistory.join("\n\n"),
          });
        }

        const result = await this.runAgentWithTracking(debater, exec, {
          task,
          data: exec.blackboard,
        }, crew, signal);

        const roundLabel = locale === "en" ? `Round ${round + 1}` : `第${round + 1}轮`;
        const entry = `[${debater.role} - ${roundLabel}]: ${result.content}`;
        debateHistory.push(entry);
        roundContent += result.content;
      }

      this.emit({ type: "round:complete", round: round + 1, timestamp: Date.now() });

      if (prevRoundContent && this.textSimilarity(roundContent, prevRoundContent) > 0.8) break;
      prevRoundContent = roundContent;
    }

    // Final judgment
    if (judge) {
      this.checkAborted(signal);
      const summary = debateHistory.length > 6
        ? [...debateHistory.slice(0, 2), "...", ...debateHistory.slice(-2)]
        : debateHistory;

      const judgeResult = await this.runAgentWithTracking(judge, exec, {
        task: resolvePrompt(getPrompt("debate_judge", locale, crew.promptOverrides), {
          task: crew.task,
          summary: summary.join("\n\n---\n\n"),
        }),
        data: exec.blackboard,
      }, crew, signal);
      exec.finalOutput = judgeResult.data ?? judgeResult.content;
    } else {
      exec.finalOutput = { debate: debateHistory, rounds: exec.round };
    }
  }

  // ─── Hierarchy Mode ─────────────────────────────────────────────────────

  private async executeHierarchy(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    const locale = this.getLocale(crew);
    const errorStrategy = crew.errorStrategy ?? "fail-fast";

    const lead = this.findAgentByRole(crew, "lead", 0) ?? crew.agents[0]!;
    const workers = crew.agents.filter(a => a !== lead);

    // Edge case: no workers — lead does the task solo
    if (workers.length === 0) {
      const result = await this.runAgentWithTracking(lead, exec, { task: crew.task, data: exec.blackboard }, crew, signal);
      exec.finalOutput = result.data ?? result.content;
      return;
    }

    // Step 1: Lead decomposes task
    this.checkAborted(signal);
    const planResult = await this.runAgentWithTracking(lead, exec, {
      task: resolvePrompt(getPrompt("hierarchy_plan", locale, crew.promptOverrides), {
        task: crew.task,
        workers: workers.map(w => w.role).join(", "),
      }),
      data: exec.blackboard,
    }, crew, signal);

    const subtasks = this.parseSubtasks(planResult.content, workers, crew.task);

    // Step 2: Workers execute in parallel
    this.checkAborted(signal);
    const workerResults = await this.runParallelWithStrategy(
      subtasks.map(s => s.agent),
      (agent) => {
        const subtask = subtasks.find(s => s.agent.id === agent.id)?.subtask ?? crew.task;
        return this.runAgentWithTracking(agent, exec, {
          task: subtask,
          data: exec.blackboard,
          blackboard: agent.context.mode === "shared" ? exec.blackboard : undefined,
        }, crew, signal);
      },
      errorStrategy
    );

    // Step 3: Lead synthesizes results
    this.checkAborted(signal);
    const resultsText = workerResults
      .filter(r => r.result)
      .map(r => `[${r.agent.role}]: ${r.result!.content}`)
      .join("\n\n");

    const finalResult = await this.runAgentWithTracking(lead, exec, {
      task: resolvePrompt(getPrompt("hierarchy_synthesize", locale, crew.promptOverrides), { results: resultsText }),
      data: exec.blackboard,
    }, crew, signal);

    exec.finalOutput = finalResult.data ?? finalResult.content;
  }

  // ─── Auto Mode ──────────────────────────────────────────────────────────

  private async executeAuto(crew: CrewDef, exec: CrewExecution, signal?: AbortSignal): Promise<void> {
    // Improved heuristic based on roleType and agent count
    if (crew.agents.length === 1) {
      await this.executeSolo(crew, exec, signal);
    } else if (this.findAgentByRole(crew, "reviewer")) {
      await this.executeReflect(crew, exec, signal);
    } else if (this.findAgentByRole(crew, "judge")) {
      await this.executeDebate(crew, exec, signal);
    } else if (this.findAgentByRole(crew, "lead")) {
      await this.executeHierarchy(crew, exec, signal);
    } else if (this.findAgentByRole(crew, "aggregator")) {
      await this.executeMoA(crew, exec, signal);
    } else if (crew.flow && crew.flow.length > 0) {
      await this.executePipeline(crew, exec, signal);
    } else if (crew.agents.length === 2) {
      // 2 agents without explicit roles: try reflect if second looks like reviewer
      const second = crew.agents[1]!;
      if (second.role.includes("审查") || second.role.includes("review") || second.role.includes("critic")) {
        await this.executeReflect(crew, exec, signal);
      } else {
        await this.executeParallel(crew, exec, signal);
      }
    } else {
      await this.executeParallel(crew, exec, signal);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async runAgentWithTracking(
    agent: AgentDef,
    exec: CrewExecution,
    input: AgentRunInput,
    crew: CrewDef,
    signal?: AbortSignal
  ) {
    this.checkAborted(signal);

    // Budget check
    const budget = (crew.budget?.maxTokens) ?? (exec.blackboard._budget as number | undefined);
    if (budget && exec.metrics.totalTokens >= budget) {
      throw new Error(`Token budget exceeded (${exec.metrics.totalTokens}/${budget})`);
    }

    this.emit({ type: "agent:start", agentId: agent.id, role: agent.role, round: exec.round, timestamp: Date.now() });

    const state = exec.agentStates.get(agent.id) ?? { agentId: agent.id, status: "idle" as const, tokenUsage: 0, rounds: 0 };
    if (!exec.agentStates.has(agent.id)) exec.agentStates.set(agent.id, state);
    state.status = "thinking";

    const maxRetries = agent.behavior.maxRetries ?? 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.checkAborted(signal);
      try {
        const result = await runAgent(agent, input);

        // Validate non-empty output
        if (!result.content || result.content.trim().length === 0) {
          if (attempt < maxRetries) {
            await this.sleep(1000 * (attempt + 1));
            continue;
          }
          result.content = "[Agent returned empty response]";
        }

        state.status = "done";
        state.output = result.data ?? result.content;
        state.tokenUsage += result.tokenUsage;
        state.rounds++;

        exec.metrics.totalTokens += result.tokenUsage;
        exec.metrics.agentTokens[agent.id] = (exec.metrics.agentTokens[agent.id] ?? 0) + result.tokenUsage;

        const msg: CrewMessage = {
          id: uuidv7(),
          from: agent.id,
          to: "blackboard",
          type: "result",
          content: result.content,
          data: result.data,
          timestamp: Date.now(),
          round: exec.round,
        };
        exec.messages.push(msg);
        this.emit({ type: "message", message: msg });
        this.emit({ type: "agent:done", agentId: agent.id, output: result.data ?? result.content, tokens: result.tokenUsage, timestamp: Date.now() });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          await this.sleep(1000 * Math.pow(2, attempt));
          continue;
        }
      }
    }

    state.status = "failed";
    state.lastError = lastError?.message ?? "Unknown error";
    this.emit({ type: "agent:error", agentId: agent.id, error: state.lastError, timestamp: Date.now() });
    throw lastError ?? new Error("Agent execution failed");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private textSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const getBigrams = (text: string): Set<string> => {
      const words = text.replace(/[^\w\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean);
      const bigrams = new Set<string>();
      for (let i = 0; i < words.length - 1; i++) bigrams.add(`${words[i]} ${words[i + 1]}`);
      return bigrams;
    };
    const setA = getBigrams(a);
    const setB = getBigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const item of setA) { if (setB.has(item)) intersection++; }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private getVisibleMessages(agent: AgentDef, exec: CrewExecution): CrewMessage[] {
    switch (agent.context.mode) {
      case "shared": return exec.messages;
      case "isolated": return exec.messages.filter(m => m.from === agent.id || m.to === agent.id);
      case "selective":
        const visible = new Set(agent.context.shareWith ?? []);
        visible.add(agent.id);
        return exec.messages.filter(m => visible.has(m.from) || visible.has(m.to) || m.to === "all");
      default: return exec.messages;
    }
  }

  private createReflector(generator: AgentDef, locale: PromptLocale): AgentDef {
    const role = locale === "en" ? "Quality Reviewer" : "质量审查员";
    const prompt = locale === "en"
      ? "You are a strict quality reviewer. Evaluate output quality (1-10), point out issues and give specific improvement suggestions. Append ```json\n{\"score\": N}\n``` at the end."
      : "你是一个严格的质量审查员。评估输出的质量（1-10分），指出问题并给出具体改进建议。在回复末尾附上 ```json\n{\"score\": N}\n```";
    return {
      ...generator,
      id: `${generator.id}-reflector`,
      role,
      roleType: "reviewer",
      systemPrompt: prompt,
      context: { mode: "shared" },
      behavior: { ...generator.behavior },
    };
  }

  private extractScore(text: string): number {
    const jsonMatch = text.match(/```json[\s\S]*?"score"\s*:\s*(\d+)/);
    if (jsonMatch) return parseInt(jsonMatch[1]!, 10);
    const inlineJson = text.match(/\{[^}]*"score"\s*:\s*(\d+)/);
    if (inlineJson) return parseInt(inlineJson[1]!, 10);
    const slashMatch = text.match(/(\d+)\s*[/／]\s*10/);
    if (slashMatch) return parseInt(slashMatch[1]!, 10);
    const fenMatch = text.match(/(\d+)\s*分/);
    if (fenMatch) return parseInt(fenMatch[1]!, 10);
    const labelMatch = text.match(/(?:score|评分|打分|得分|分数)[：:]\s*(\d+)/i);
    if (labelMatch) return parseInt(labelMatch[1]!, 10);
    const nearKeyword = text.match(/(?:给|打|评|得)\s*(\d+)\s*分/);
    if (nearKeyword) return parseInt(nearKeyword[1]!, 10);
    const anyScore = text.match(/\b([1-9]|10)\b/);
    if (anyScore) return parseInt(anyScore[1]!, 10);
    return 5;
  }

  private parseSubtasks(text: string, workers: AgentDef[], fallbackTask: string): Array<{ agent: AgentDef; subtask: string }> {
    if (workers.length === 0) return [];

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tasks = JSON.parse(jsonMatch[0]) as Array<{ agent: string; subtask: string }>;
        return tasks.map((t, i) => {
          const worker = workers.find(w => w.role.includes(t.agent) || w.id === t.agent) ?? workers[i % workers.length]!;
          return { agent: worker, subtask: t.subtask };
        });
      }
    } catch { /* fall through */ }
    return workers.map(w => ({ agent: w, subtask: fallbackTask }));
  }

  private createExecution(crew: CrewDef): CrewExecution {
    const agentStates = new Map<string, AgentState>();
    for (const agent of crew.agents) {
      agentStates.set(agent.id, { agentId: agent.id, status: "idle", tokenUsage: 0, rounds: 0 });
    }
    return {
      crewId: crew.id,
      executionId: uuidv7(),
      status: "running",
      startTime: Date.now(),
      round: 0,
      agentStates,
      blackboard: {},
      messages: [],
      metrics: { totalTokens: 0, totalCost: 0, totalRounds: 0, agentTokens: {}, duration: 0 },
    };
  }
}
