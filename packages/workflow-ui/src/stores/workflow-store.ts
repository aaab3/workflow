/**
 * Zustand store for workflow editor state.
 */

import { create } from "zustand";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import type { Workflow, WorkflowNode, WorkflowEdge } from "../api/client";
import { history } from "./history";

export interface WorkflowState {
  // Current workflow
  workflowId: string | null;
  workflowName: string;
  workflowVersion: string;

  // React Flow state
  nodes: Node[];
  edges: Edge[];

  // Selection
  selectedNodeId: string | null;

  // Actions
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  selectNode: (nodeId: string | null) => void;
  addNode: (node: Node) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<Node["data"]>) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Workflow I/O
  loadWorkflow: (workflow: Workflow) => void;
  toWorkflow: () => Partial<Workflow>;
  reset: () => void;
}

// Convert API workflow nodes to React Flow nodes
function toFlowNodes(nodes: WorkflowNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      label: n.data.label,
      config: n.data.config,
      inputs: n.data.inputs,
      outputs: n.data.outputs,
      moduleType: n.type,
    },
  }));
}

// Convert API workflow edges to React Flow edges
function toFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    data: { condition: e.condition },
  }));
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflowId: null,
  workflowName: "Untitled Workflow",
  workflowVersion: "1.0.0",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  canUndo: false,
  canRedo: false,

  onNodesChange: (changes) => {
    const prev = get();
    const nodes = applyNodeChanges(changes, prev.nodes);
    // Only push to history for structural changes (add/remove), not position drags
    const isStructural = changes.some((c) => c.type === "remove" || c.type === "add");
    if (isStructural) {
      history.push(prev.nodes, prev.edges);
    }
    set({ nodes, canUndo: history.canUndo, canRedo: history.canRedo });
  },

  onEdgesChange: (changes) => {
    const prev = get();
    const isStructural = changes.some((c) => c.type === "remove" || c.type === "add");
    if (isStructural) {
      history.push(prev.nodes, prev.edges);
    }
    set({ edges: applyEdgeChanges(changes, prev.edges), canUndo: history.canUndo, canRedo: history.canRedo });
  },

  onConnect: (connection) => {
    const prev = get();
    history.push(prev.nodes, prev.edges);
    set({ edges: addEdge(connection, prev.edges), canUndo: history.canUndo, canRedo: history.canRedo });
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  addNode: (node) => {
    const prev = get();
    history.push(prev.nodes, prev.edges);
    set({ nodes: [...prev.nodes, node], canUndo: history.canUndo, canRedo: history.canRedo });
  },

  removeNode: (nodeId) => {
    const prev = get();
    history.push(prev.nodes, prev.edges);
    set({
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: prev.selectedNodeId === nodeId ? null : prev.selectedNodeId,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  },

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    });
  },

  loadWorkflow: (workflow) => {
    set({
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowVersion: workflow.version,
      nodes: toFlowNodes(workflow.nodes),
      edges: toFlowEdges(workflow.edges),
      selectedNodeId: null,
    });
  },

  toWorkflow: () => {
    const state = get();
    return {
      id: state.workflowId ?? undefined,
      name: state.workflowName,
      version: state.workflowVersion,
      nodes: state.nodes.map((n) => ({
        id: n.id,
        type: (n.data.moduleType as string) ?? n.type ?? "code-javascript",
        position: n.position,
        data: {
          label: (n.data.label as string) ?? n.id,
          config: (n.data.config as Record<string, unknown>) ?? {},
          inputs: ((n.data.inputs as unknown[]) ?? []) as WorkflowNode["data"]["inputs"],
          outputs: ((n.data.outputs as unknown[]) ?? []) as WorkflowNode["data"]["outputs"],
        },
      })),
      edges: state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? "output",
        target: e.target,
        targetHandle: e.targetHandle ?? "input",
      })),
    } as Partial<Workflow>;
  },

  undo: () => {
    const entry = history.undo();
    if (entry) {
      set({ nodes: entry.nodes, edges: entry.edges, canUndo: history.canUndo, canRedo: history.canRedo });
    }
  },

  redo: () => {
    const entry = history.redo();
    if (entry) {
      set({ nodes: entry.nodes, edges: entry.edges, canUndo: history.canUndo, canRedo: history.canRedo });
    }
  },

  reset: () => {
    history.init([], []);
    set({
      workflowId: null,
      workflowName: "Untitled Workflow",
      workflowVersion: "1.0.0",
      nodes: [],
      edges: [],
      selectedNodeId: null,
      canUndo: false,
      canRedo: false,
    });
  },
}));
