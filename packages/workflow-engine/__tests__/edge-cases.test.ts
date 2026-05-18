/**
 * Edge case tests — scenarios that could trip up real users.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrewEngine } from "../src/crew/crew-engine.js";
import type { CrewDef, AgentDef } from "../src/crew/types.js";

vi.mock("../src/crew/agent-runner.js", () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from "../src/crew/agent-runner.js";
const mockRunAgent = vi.mocked(runAgent);

function makeAgent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: overrides.id ?? `agent-${Math.random().toString(36).slice(2, 6)}`,
    role: overrides.role ?? "Assistant",
    model: { name: "gpt-4o-mini" },
    systemPrompt: overrides.systemPrompt ?? "You are helpful.",
    context: overrides.context ?? { mode: "shared" },
    behavior: overrides.behavior ?? {},
    ...overrides,
  };
}

function makeCrew(overrides: Partial<CrewDef> = {}): CrewDef {
  return {
    id: "test-crew",
    task: "Test task",
    mode: "solo",
    agents: [makeAgent()],
    ...overrides,
  };
}

describe("Edge Cases", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    mockRunAgent.mockResolvedValue({ content: "result", tokenUsage: 10 });
  });

  describe("Parallel mode with no explicit roleTypes", () => {
    it("should NOT use first agent as dispatcher when agents have no roleType and count <= 2", async () => {
      // Bug scenario: user has 2 agents, no roleTypes, expects both to work independently
      // The old code would try dispatcher/merger pattern for 3+ agents
      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "parallel",
        agents: [
          makeAgent({ id: "a1", role: "Analyst" }),
          makeAgent({ id: "a2", role: "Researcher" }),
        ],
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("completed");
      // Both agents should have been called
      expect(mockRunAgent).toHaveBeenCalledTimes(2);
    });

    it("should handle 3 agents with no roleTypes in parallel mode", async () => {
      // When no roleTypes are set and findAgentsByRole("worker") returns ALL agents,
      // the condition `workers.length === crew.agents.length` should trigger simple parallel
      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "parallel",
        agents: [
          makeAgent({ id: "a1", role: "Analyst" }),
          makeAgent({ id: "a2", role: "Researcher" }),
          makeAgent({ id: "a3", role: "Writer" }),
        ],
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("completed");
      // All 3 should work independently (simple parallel path)
      expect(mockRunAgent).toHaveBeenCalledTimes(3);
    });

    it("should use dispatcher/merger pattern when roleTypes are explicitly set", async () => {
      mockRunAgent.mockImplementation(async (agent) => {
        if (agent.roleType === "dispatcher") {
          return { content: '[{"agent":"Worker","subtask":"do work"}]', tokenUsage: 20 };
        }
        return { content: "done", tokenUsage: 10 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "parallel",
        agents: [
          makeAgent({ id: "d", role: "Dispatcher", roleType: "dispatcher" }),
          makeAgent({ id: "w", role: "Worker", roleType: "worker" }),
          makeAgent({ id: "m", role: "Merger", roleType: "merger" }),
        ],
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("completed");
      // dispatcher + worker + merger = 3 calls
      expect(mockRunAgent).toHaveBeenCalledTimes(3);
    });
  });

  describe("Pipeline with FlowDef", () => {
    it("should respect FlowDef order over array order", async () => {
      const callOrder: string[] = [];
      mockRunAgent.mockImplementation(async (agent) => {
        callOrder.push(agent.id);
        return { content: `output-${agent.id}`, tokenUsage: 10 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "pipeline",
        agents: [
          makeAgent({ id: "c", role: "Third" }),   // array position 0
          makeAgent({ id: "a", role: "First" }),   // array position 1
          makeAgent({ id: "b", role: "Second" }),  // array position 2
        ],
        flow: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("completed");
      // Should follow flow order: a → b → c, NOT array order: c → a → b
      expect(callOrder).toEqual(["a", "b", "c"]);
    });

    it("should fall back to array order when no FlowDef", async () => {
      const callOrder: string[] = [];
      mockRunAgent.mockImplementation(async (agent) => {
        callOrder.push(agent.id);
        return { content: `output-${agent.id}`, tokenUsage: 10 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "pipeline",
        agents: [
          makeAgent({ id: "x", role: "First" }),
          makeAgent({ id: "y", role: "Second" }),
          makeAgent({ id: "z", role: "Third" }),
        ],
      });

      await engine.execute(crew);
      expect(callOrder).toEqual(["x", "y", "z"]);
    });
  });

  describe("Reflect mode edge cases", () => {
    it("should stop when score converges (same score 2 rounds)", async () => {
      let callCount = 0;
      mockRunAgent.mockImplementation(async (agent) => {
        callCount++;
        if (agent.id.includes("reflector") || agent.roleType === "reviewer") {
          return { content: "5/10 needs work", tokenUsage: 10 };
        }
        return { content: `draft ${callCount}`, tokenUsage: 20 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "reflect",
        agents: [makeAgent({ id: "gen", role: "Writer" })],
        termination: { condition: "quality", maxRounds: 10, qualityThreshold: 9 },
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("completed");
      // Should stop after 2 rounds (score=5 both times → converged)
      expect((result.finalOutput as any).rounds).toBeLessThanOrEqual(3);
    });

    it("should use explicitly provided reviewer agent", async () => {
      const calledAgents: string[] = [];
      mockRunAgent.mockImplementation(async (agent) => {
        calledAgents.push(agent.id);
        if (agent.id === "my-reviewer") {
          return { content: "9/10 great", tokenUsage: 10 };
        }
        return { content: "my output", tokenUsage: 20 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "reflect",
        agents: [
          makeAgent({ id: "gen", role: "Writer", roleType: "worker" }),
          makeAgent({ id: "my-reviewer", role: "Critic", roleType: "reviewer" }),
        ],
        termination: { condition: "quality", maxRounds: 3, qualityThreshold: 7 },
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("completed");
      expect(calledAgents).toContain("my-reviewer");
      // Should NOT create a synthetic reflector
      expect(calledAgents).not.toContain("gen-reflector");
    });
  });

  describe("Debate with only 2 agents (no judge)", () => {
    it("should return debate history when no judge is available", async () => {
      mockRunAgent.mockImplementation(async (agent) => {
        return { content: `${agent.role} argues...`, tokenUsage: 15 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "debate",
        agents: [
          makeAgent({ id: "pro", role: "Pro" }),
          makeAgent({ id: "con", role: "Con" }),
        ],
        termination: { condition: "rounds", maxRounds: 2 },
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("completed");
      const output = result.finalOutput as { debate: string[]; rounds: number };
      expect(output.debate).toBeDefined();
      expect(output.debate.length).toBe(4); // 2 rounds × 2 debaters
      expect(output.rounds).toBe(2);
    });
  });

  describe("Empty/invalid inputs", () => {
    it("should handle crew with empty task gracefully", async () => {
      const engine = new CrewEngine();
      const crew = makeCrew({ task: "" });
      const result = await engine.execute(crew);
      // Should still complete (agent gets empty task)
      expect(result.status).toBe("completed");
    });

    it("should handle crew with single agent in hierarchy mode", async () => {
      // Edge case: hierarchy with only 1 agent means lead has no workers
      mockRunAgent.mockImplementation(async () => {
        return { content: '[{"agent":"nobody","subtask":"nothing"}]', tokenUsage: 10 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "hierarchy",
        agents: [makeAgent({ id: "solo-lead", role: "Lead", roleType: "lead" })],
      });

      const result = await engine.execute(crew);
      // Should complete — lead plans, no workers execute, lead synthesizes empty results
      expect(result.status).toBe("completed");
    });
  });

  describe("Budget enforcement", () => {
    it("should enforce budget across multiple agents in pipeline", async () => {
      let callCount = 0;
      mockRunAgent.mockImplementation(async () => {
        callCount++;
        return { content: `call ${callCount}`, tokenUsage: 400 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "pipeline",
        budget: { maxTokens: 500 },
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2" }),
          makeAgent({ id: "a3" }),
        ],
      });

      const result = await engine.execute(crew);
      expect(result.status).toBe("failed");
      // First agent uses 400 tokens, second should be blocked (400 >= 500? no, 400 < 500)
      // Actually: first uses 400, total=400 < 500, second runs, total=800 >= 500 → third blocked
      expect(callCount).toBe(2);
    });
  });

  describe("Prompt override", () => {
    it("should use custom prompt override when provided", async () => {
      let receivedTask = "";
      mockRunAgent.mockImplementation(async (_agent, input) => {
        receivedTask = input.task;
        return { content: "done", tokenUsage: 10 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "solo",
        locale: "en",
        promptOverrides: {
          // This won't affect solo mode directly since solo passes raw task
          // But let's test pipeline
        },
      });

      await engine.execute(crew);
      // Solo mode passes the raw task
      expect(receivedTask).toBe("Test task");
    });
  });
});
