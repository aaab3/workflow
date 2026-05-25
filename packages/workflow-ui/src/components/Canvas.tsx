import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type NodeTypes,
  type IsValidConnection,
  type Connection,
} from "@xyflow/react";
import { useWorkflowStore } from "../stores/workflow-store";
import { useModulesStore } from "../stores/modules-store";
import { useExecutionStore } from "../stores/execution-store";
import { WorkflowNodeMemo } from "./nodes/WorkflowNode";
import type { PortDef } from "../api/client";

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeMemo,
};

interface CanvasProps {
  onNodeDoubleClick?: (nodeId: string, moduleType: string) => void;
}

export function Canvas({ onNodeDoubleClick }: CanvasProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectNode,
    isValidConnection,
  } = useWorkflowStore();
  const getModule = useModulesStore((s) => s.get);
  const isRunning = useExecutionStore((s) => s.isRunning);

  const mappedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, type: "workflowNode" as const })),
    [nodes]
  );

  const mappedEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        animated: isRunning,
        style: isRunning
          ? { strokeWidth: 2, stroke: "#6366f1" }
          : { strokeWidth: 2, stroke: "#94a3b8" },
      })),
    [edges, isRunning]
  );

  const checkValidConnection: IsValidConnection = useCallback(
    (connection) => isValidConnection(connection as Connection),
    [isValidConnection]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => selectNode(node.id),
    [selectNode]
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const moduleType = (node.data as Record<string, unknown>).moduleType as string;
      onNodeDoubleClick?.(node.id, moduleType ?? "");
    },
    [onNodeDoubleClick]
  );

  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const moduleType = event.dataTransfer.getData("application/workflow-module");
      const moduleLabel = event.dataTransfer.getData("application/workflow-label");
      const category = event.dataTransfer.getData("application/workflow-category");

      if (!moduleType) return;

      const bounds = (event.target as HTMLElement)
        .closest(".react-flow")
        ?.getBoundingClientRect();
      if (!bounds) return;

      const position = {
        x: event.clientX - bounds.left - 90,
        y: event.clientY - bounds.top - 20,
      };

      const meta = getModule(moduleType);
      const inputs: PortDef[] = meta?.inputs?.length
        ? meta.inputs
        : [{ id: "input", name: "输入", type: "any" }];
      const outputs: PortDef[] = meta?.outputs?.length
        ? meta.outputs
        : [{ id: "output", name: "输出", type: "any" }];

      useWorkflowStore.getState().addNode({
        id: `node-${Date.now()}`,
        type: "workflowNode",
        position,
        data: {
          label: moduleLabel || moduleType,
          moduleType,
          category: category || meta?.category,
          config: {},
          inputs,
          outputs,
        },
      });
    },
    [getModule]
  );

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={mappedNodes}
        edges={mappedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={checkValidConnection}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
          style: { strokeWidth: 2, stroke: "#94a3b8" },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#e2e8f0" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          maskColor="rgba(15, 23, 42, 0.06)"
        />
      </ReactFlow>
    </div>
  );
}
