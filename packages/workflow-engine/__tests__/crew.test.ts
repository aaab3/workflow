/**
 * Crew Engine Tests
 *
 * Tests all collaboration modes with mocked LLM calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrewEngine } from "../src/crew/crew-engine.js";
import type { CrewDef, AgentDef, CrewEvent } from "../src/crew/types.js";

// Mock the agent-runner module
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
    task: "Write a poem about cats",
    mode: "solo",
    agents: [makeAgent()],
    ...overrides,
  };
}

describe("CrewEngine", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
  });

  describe("Solo Mode", () => {
    it("should execute a single agent and return its output", async () => {
      mockRunAgent.mockResolvedValueOnce({
        content: "Cats are wonderful creatures.",
        tokenUsage: 50,
      });

      const engine = new CrewEngine();
      const crew = makeCrew({ mode: "solo" });
      const result = await engine.execute(crew);

      expect(result.status).toBe("completed");
      expect(result.finalOutput).toBe("Cats are wonderful creatures.");
      expect(result.metrics.totalTokens).toBe(50);
      expect(mockRunAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe("Pipeline Mode", () => {
    it("should execute agents sequentially", async () => {
      const callOrder: string[] = [];

      mockRunAgent.mockImplementation(async (agent) => {
        callOrder.push(agent.id);
        return { content: `Output from ${agent.id}`, tokenUsage: 30 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "pipeline",
        agents: [
          makeAgent({ id: "writer", role: "Writer" }),
          makeAgent({ id: "editor", role: "Editor" }),
          makeAgent({ id: "reviewer", role: "Reviewer" }),
        ],
      });

      const result = await engine.execute(crew);

      expect(result.status).toBe("completed");
      expect(callOrder).toEqual(["writer", "editor", "reviewer"]);
      expect(result.metrics.totalTokens).toBe(90);
    });
  });

  describe("Parallel Mode (simple)", () => {
    it("should execute 2 agents in parallel", async () => {
      mockRunAgent.mockImplementation(async (agent) => {
        return { content: `Result from ${agent.role}`, tokenUsage: 25 };
      });

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
      expect(result.metrics.totalTokens).toBe(50);
      expect(mockRunAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe("Reflect Mode", () => {
    it("should iterate until quality threshold is met", async () => {
      let callCount = 0;
      mockRunAgent.mockImplementation(async (agent) => {
        callCount++;
        if (agent.id.includes("reflector") || agent.roleType === "reviewer") {
          // Reviewer: give increasing scores
          const score = callCount <= 2 ? 5 : 8;
          return { content: `${score}/10 Good work`, tokenUsage: 20 };
        }
        return { content: `Draft version ${callCount}`, tokenUsage: 40 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "reflect",
        agents: [makeAgent({ id: "gen", role: "Writer" })],
        termination: { condition: "quality", maxRounds: 5, qualityThreshold: 7 },
      });

      const result = await engine.execute(crew);

      expect(result.status).toBe("completed");
      expect((result.finalOutput as any).score).toBeGreaterThanOrEqual(7);
    });
  });

  describe("AbortSignal", () => {
    it("should cancel execution when signal is aborted", async () => {
      mockRunAgent.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 100));
        return { content: "result", tokenUsage: 10 };
      });

      const engine = new CrewEngine();
      const controller = new AbortController();

      const crew = makeCrew({
        mode: "pipeline",
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2" }),
          makeAgent({ id: "a3" }),
        ],
      });

      // Abort after 50ms
      setTimeout(() => controller.abort(), 50);

      const result = await engine.execute(crew, undefined, { signal: controller.signal });

      expect(result.status).toBe("cancelled");
    });
  });

  describe("Error Strategy", () => {
    it("should continue on agent failure with continue strategy", async () => {
      let callCount = 0;
      mockRunAgent.mockImplementation(async (agent) => {
        callCount++;
        if (agent.id === "failing") throw new Error("Agent failed");
        return { content: `Result from ${agent.id}`, tokenUsage: 20 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "parallel",
        errorStrategy: "continue",
        agents: [
          makeAgent({ id: "good1", role: "Worker 1" }),
          makeAgent({ id: "failing", role: "Worker 2" }),
        ],
      });

      const result = await engine.execute(crew);

      expect(result.status).toBe("completed");
      // Should still have output from the successful agent
      const output = result.finalOutput as Record<string, unknown>;
      expect(output["good1"]).toBe("Result from good1");
    });
  });

  describe("RoleType-based lookup", () => {
    it("should find agents by roleType in hierarchy mode", async () => {
      const callOrder: string[] = [];
      mockRunAgent.mockImplementation(async (agent) => {
        callOrder.push(agent.id);
        if (agent.roleType === "lead" && callOrder.length === 1) {
          return { content: '[{"agent":"Dev","subtask":"code it"}]', tokenUsage: 30 };
        }
        return { content: `Done by ${agent.role}`, tokenUsage: 20 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "hierarchy",
        agents: [
          makeAgent({ id: "dev", role: "Dev", roleType: "worker" }),
          makeAgent({ id: "pm", role: "PM", roleType: "lead" }),
        ],
      });

      const result = await engine.execute(crew);

      expect(result.status).toBe("completed");
      // PM (lead) should be called first for planning
      expect(callOrder[0]).toBe("pm");
    });
  });

  describe("Events", () => {
    it("should emit crew lifecycle events", async () => {
      mockRunAgent.mockResolvedValue({ content: "done", tokenUsage: 10 });

      const engine = new CrewEngine();
      const events: CrewEvent[] = [];
      engine.on(e => events.push(e));

      const crew = makeCrew({ mode: "solo" });
      await engine.execute(crew);

      const types = events.map(e => e.type);
      expect(types).toContain("crew:start");
      expect(types).toContain("agent:start");
      expect(types).toContain("agent:done");
      expect(types).toContain("crew:complete");
    });
  });

  describe("Token Budget", () => {
    it("should stop when token budget is exceeded", async () => {
      let callCount = 0;
      mockRunAgent.mockImplementation(async () => {
        callCount++;
        return { content: `call ${callCount}`, tokenUsage: 600 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({
        mode: "pipeline",
        budget: { maxTokens: 1000 },
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2" }),
          makeAgent({ id: "a3" }),
        ],
      });

      const result = await engine.execute(crew);

      expect(result.status).toBe("failed");
      // Should have stopped before completing all 3 agents
      expect(callCount).toBeLessThan(3);
    });
  });

  describe("Locale", () => {
    it("should use English prompts when locale is en", async () => {
      let receivedTask = "";
      mockRunAgent.mockImplementation(async (_agent, input) => {
        receivedTask = input.task;
        return { content: "result", tokenUsage: 10 };
      });

      const engine = new CrewEngine();
      const crew = makeCrew({ mode: "solo", locale: "en" });
      await engine.execute(crew);

      // The task should not contain Chinese characters from templates
      // (solo mode passes the raw task, but other modes would use templates)
      expect(receivedTask).toContain("Write a poem about cats");
    });
  });
});
