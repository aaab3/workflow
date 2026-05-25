import { describe, it, expect } from "vitest";
import { buildGraph, GraphValidationError } from "../src/graph.js";
import type { Workflow } from "../src/types.js";

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "test-workflow",
    name: "Test",
    version: "1.0.0",
    nodes: [],
    edges: [],
    variables: [],
    triggers: [],
    settings: {
      maxExecutionTime: 30000,
      maxNodeRetries: 0,
      errorStrategy: "fail-fast",
      concurrencyLimit: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildGraph", () => {
  it("should build a valid graph from a simple linear workflow", () => {
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "io-file-read", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "b", type: "code-javascript", position: { x: 100, y: 0 }, data: { label: "B", config: {}, inputs: [], outputs: [] } },
        { id: "c", type: "io-file-write", position: { x: 200, y: 0 }, data: { label: "C", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "content", target: "b", targetHandle: "input" },
        { id: "e2", source: "b", sourceHandle: "output", target: "c", targetHandle: "content" },
      ],
    });

    const graph = buildGraph(workflow);

    expect(graph.entryNodes).toEqual(["a"]);
    expect(graph.sortedIds).toEqual(["a", "b", "c"]);
    expect(graph.nodes.size).toBe(3);
  });

  it("should detect cycles and throw GraphValidationError", () => {
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "b", type: "test", position: { x: 100, y: 0 }, data: { label: "B", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
        { id: "e2", source: "b", sourceHandle: "out", target: "a", targetHandle: "in" },
      ],
    });

    expect(() => buildGraph(workflow)).toThrow(GraphValidationError);
    expect(() => buildGraph(workflow)).toThrow(/Cycle detected/);
  });

  it("should handle multiple entry nodes (parallel starts)", () => {
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "b", type: "test", position: { x: 0, y: 100 }, data: { label: "B", config: {}, inputs: [], outputs: [] } },
        { id: "c", type: "test", position: { x: 100, y: 50 }, data: { label: "C", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "c", targetHandle: "in1" },
        { id: "e2", source: "b", sourceHandle: "out", target: "c", targetHandle: "in2" },
      ],
    });

    const graph = buildGraph(workflow);

    expect(graph.entryNodes).toContain("a");
    expect(graph.entryNodes).toContain("b");
    expect(graph.entryNodes).toHaveLength(2);
    // c must come after both a and b
    const cIndex = graph.sortedIds.indexOf("c");
    const aIndex = graph.sortedIds.indexOf("a");
    const bIndex = graph.sortedIds.indexOf("b");
    expect(cIndex).toBeGreaterThan(aIndex);
    expect(cIndex).toBeGreaterThan(bIndex);
  });

  it("should throw on duplicate node IDs", () => {
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
        { id: "a", type: "test", position: { x: 100, y: 0 }, data: { label: "A2", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [],
    });

    try {
      buildGraph(workflow);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GraphValidationError);
      const err = e as GraphValidationError;
      expect(err.details.some((d) => d.message.includes("Duplicate node ID"))).toBe(true);
    }
  });

  it("should throw on edges referencing non-existent nodes", () => {
    const workflow = makeWorkflow({
      nodes: [
        { id: "a", type: "test", position: { x: 0, y: 0 }, data: { label: "A", config: {}, inputs: [], outputs: [] } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "nonexistent", targetHandle: "in" },
      ],
    });

    try {
      buildGraph(workflow);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GraphValidationError);
      const err = e as GraphValidationError;
      expect(err.details.some((d) => d.message.includes("unknown target node"))).toBe(true);
    }
  });
});
