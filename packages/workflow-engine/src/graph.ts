/**
 * Graph construction, validation, and topological sorting.
 */

import type { Workflow, WorkflowEdge, WorkflowNode } from "./types.js";

export interface GraphNode {
  id: string;
  node: WorkflowNode;
  inEdges: WorkflowEdge[];
  outEdges: WorkflowEdge[];
  inDegree: number;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  entryNodes: string[]; // nodes with no incoming edges
  sortedIds: string[];  // topological order
}

export class GraphValidationError extends Error {
  constructor(
    message: string,
    public readonly details: Array<{ nodeId?: string; message: string }>
  ) {
    super(message);
    this.name = "GraphValidationError";
  }
}

/**
 * Build a Graph from a Workflow definition.
 * Validates structure and produces a topological ordering.
 */
export function buildGraph(workflow: Workflow): Graph {
  const errors: Array<{ nodeId?: string; message: string }> = [];
  const nodes = new Map<string, GraphNode>();

  // Check for empty workflow
  if (!workflow.nodes || workflow.nodes.length === 0) {
    throw new GraphValidationError("Workflow has no nodes", [
      { message: "Workflow must contain at least one node" },
    ]);
  }

  // Index all nodes
  for (const node of workflow.nodes) {
    if (nodes.has(node.id)) {
      errors.push({ nodeId: node.id, message: `Duplicate node ID: ${node.id}` });
      continue;
    }
    nodes.set(node.id, {
      id: node.id,
      node,
      inEdges: [],
      outEdges: [],
      inDegree: 0,
    });
  }

  // Index all edges
  for (const edge of workflow.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);

    if (!source) {
      errors.push({ message: `Edge ${edge.id} references unknown source node: ${edge.source}` });
      continue;
    }
    if (!target) {
      errors.push({ message: `Edge ${edge.id} references unknown target node: ${edge.target}` });
      continue;
    }

    source.outEdges.push(edge);
    target.inEdges.push(edge);
    target.inDegree++;
  }

  if (errors.length > 0) {
    throw new GraphValidationError("Graph structure is invalid", errors);
  }

  // Detect cycles using Kahn's algorithm (topological sort)
  const sortedIds = topologicalSort(nodes);

  // Entry nodes: those with no incoming edges
  const entryNodes = Array.from(nodes.values())
    .filter((n) => n.inDegree === 0)
    .map((n) => n.id);

  if (entryNodes.length === 0) {
    throw new GraphValidationError("No entry nodes found (all nodes have incoming edges)", [
      { message: "Workflow must have at least one node with no incoming edges" },
    ]);
  }

  return { nodes, entryNodes, sortedIds };
}

/**
 * Kahn's algorithm for topological sorting.
 * Throws if a cycle is detected.
 */
function topologicalSort(nodes: Map<string, GraphNode>): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const [id, graphNode] of nodes) {
    inDegree.set(id, graphNode.inDegree);
    adjacency.set(
      id,
      graphNode.outEdges.map((e) => e.target)
    );
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== nodes.size) {
    // Find nodes involved in cycle
    const cycleNodes = Array.from(nodes.keys()).filter(
      (id) => !sorted.includes(id)
    );
    throw new GraphValidationError(
      `Cycle detected in workflow graph involving nodes: ${cycleNodes.join(", ")}`,
      cycleNodes.map((id) => ({ nodeId: id, message: "Part of a cycle" }))
    );
  }

  return sorted;
}

/**
 * Get all upstream dependencies for a given node (transitive).
 */
export function getUpstreamNodes(graph: Graph, nodeId: string): Set<string> {
  const visited = new Set<string>();
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const graphNode = graph.nodes.get(current);
    if (!graphNode) continue;

    for (const edge of graphNode.inEdges) {
      if (!visited.has(edge.source)) {
        visited.add(edge.source);
        stack.push(edge.source);
      }
    }
  }

  return visited;
}

/**
 * Get immediate downstream nodes for a given node.
 */
export function getDownstreamNodes(graph: Graph, nodeId: string): string[] {
  const graphNode = graph.nodes.get(nodeId);
  if (!graphNode) return [];
  return graphNode.outEdges.map((e) => e.target);
}
