import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { useWorkflowStore } from "../stores/workflow-store";
import { WorkflowNodeMemo } from "./nodes/WorkflowNode";

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeMemo,
};

interface CanvasProps {
  onNodeDoubleClick?: (nodeId: string, moduleType: string) => void;
}

export function Canvas({ onNodeDoubleClick }: CanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, selectNode } =
    useWorkflowStore();

  // Map all nodes to use our custom node type
  const mappedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, type: "workflowNode" })),
    [nodes]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const moduleType = (node.data as Record<string, unknown>).moduleType as string;
      if (onNodeDoubleClick) onNodeDoubleClick(node.id, moduleType ?? "");
    },
    [onNodeDoubleClick]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const moduleType = event.dataTransfer.getData("application/workflow-module");
      const moduleLabel = event.dataTransfer.getData("application/workflow-label");

      if (!moduleType) return;

      const bounds = (event.target as HTMLElement).closest(".react-flow")?.getBoundingClientRect();
      if (!bounds) return;

      const position = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };

      const newNode = {
        id: `node-${Date.now()}`,
        type: "workflowNode",
        position,
        data: {
          label: moduleLabel || moduleType,
          moduleType,
          config: {},
          inputs: getDefaultInputs(moduleType),
          outputs: getDefaultOutputs(moduleType),
        },
      };

      useWorkflowStore.getState().addNode(newNode);
    },
    []
  );

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={mappedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
          style: { strokeWidth: 2, stroke: "#94a3b8" },
        }}
      >
        <Background gap={20} size={1} color="#e2e8f0" />
        <Controls position="bottom-right" />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          style={{ border: "1px solid #e2e8f0", borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  );
}

// Default port definitions for each module type
function getDefaultInputs(moduleType: string) {
  switch (moduleType) {
    case "llm-chat":
      return [{ id: "userMessage", name: "用户消息", type: "string" }];
    case "io-file-read":
      return [];
    case "io-file-write":
      return [{ id: "content", name: "内容", type: "string" }];
    case "io-http-request":
      return [{ id: "body", name: "请求体", type: "any" }];
    case "io-terminal":
      return [{ id: "stdin", name: "输入内容", type: "string" }];
    case "crew":
      return [
        { id: "task", name: "任务", type: "string" },
        { id: "data", name: "数据", type: "any" },
      ];
    case "code-javascript":
      return [{ id: "data", name: "输入数据", type: "any" }];
    case "flow-condition":
      return [{ id: "value", name: "判断值", type: "any" }];
    case "flow-delay":
      return [{ id: "passthrough", name: "透传", type: "any" }];
    default:
      return [{ id: "input", name: "输入", type: "any" }];
  }
}

function getDefaultOutputs(moduleType: string) {
  switch (moduleType) {
    case "llm-chat":
      return [
        { id: "response", name: "回复", type: "string" },
        { id: "usage", name: "用量", type: "object" },
      ];
    case "io-file-read":
      return [
        { id: "content", name: "内容", type: "string" },
        { id: "size", name: "大小", type: "number" },
      ];
    case "io-file-write":
      return [{ id: "success", name: "成功", type: "boolean" }];
    case "io-http-request":
      return [
        { id: "data", name: "响应", type: "any" },
        { id: "status", name: "状态码", type: "number" },
      ];
    case "io-terminal":
      return [
        { id: "stdout", name: "输出", type: "string" },
        { id: "stderr", name: "错误", type: "string" },
        { id: "exitCode", name: "退出码", type: "number" },
      ];
    case "crew":
      return [
        { id: "result", name: "结果", type: "any" },
        { id: "messages", name: "消息", type: "array" },
        { id: "metrics", name: "指标", type: "object" },
      ];
    case "code-javascript":
      return [{ id: "result", name: "结果", type: "any" }];
    case "flow-condition":
      return [
        { id: "true", name: "真", type: "any" },
        { id: "false", name: "假", type: "any" },
      ];
    case "flow-delay":
      return [{ id: "passthrough", name: "透传", type: "any" }];
    default:
      return [{ id: "output", name: "输出", type: "any" }];
  }
}
