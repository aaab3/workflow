/**
 * Custom workflow node component.
 * Renders nodes with category-specific colors, typed input/output handles,
 * and a compact card-style layout inspired by n8n/Flowise.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

// Category color mapping
const CATEGORY_COLORS: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
  llm: { bg: "#fef3c7", border: "#f59e0b", accent: "#d97706", icon: "🤖" },
  io: { bg: "#dbeafe", border: "#3b82f6", accent: "#2563eb", icon: "🔌" },
  code: { bg: "#e0e7ff", border: "#6366f1", accent: "#4f46e5", icon: "⚡" },
  flow: { bg: "#dcfce7", border: "#22c55e", accent: "#16a34a", icon: "🔀" },
  data: { bg: "#f3e8ff", border: "#a855f7", accent: "#7c3aed", icon: "📊" },
  tool: { bg: "#f1f5f9", border: "#64748b", accent: "#475569", icon: "🔧" },
};

// Port type colors for handles
const PORT_TYPE_COLORS: Record<string, string> = {
  string: "#22c55e",
  number: "#3b82f6",
  boolean: "#f59e0b",
  object: "#a855f7",
  array: "#ec4899",
  any: "#64748b",
};

interface PortDef {
  id: string;
  name: string;
  type: string;
}

interface WorkflowNodeData {
  label: string;
  moduleType: string;
  category?: string;
  config?: Record<string, unknown>;
  inputs?: PortDef[];
  outputs?: PortDef[];
  executionStatus?: "pending" | "running" | "completed" | "failed" | "skipped";
}

function WorkflowNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData;
  const category = nodeData.category ?? getCategoryFromType(nodeData.moduleType);
  const colors = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.tool;
  const inputs = nodeData.inputs ?? [];
  const outputs = nodeData.outputs ?? [];

  // Execution status border
  const statusBorder = getStatusBorder(nodeData.executionStatus);

  return (
    <div
      style={{
        background: "white",
        borderRadius: 8,
        border: `2px solid ${statusBorder ?? (selected ? colors.accent : colors.border)}`,
        boxShadow: selected
          ? `0 0 0 2px ${colors.accent}40, 0 4px 12px rgba(0,0,0,0.1)`
          : "0 1px 4px rgba(0,0,0,0.08)",
        minWidth: 180,
        maxWidth: 260,
        fontSize: 12,
        transition: "box-shadow 0.15s, border-color 0.15s",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: colors.bg,
          borderBottom: `1px solid ${colors.border}40`,
          padding: "8px 12px",
          borderRadius: "6px 6px 0 0",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 14 }}>{colors.icon}</span>
        <span
          style={{
            fontWeight: 600,
            color: colors.accent,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {nodeData.label}
        </span>
        {nodeData.executionStatus === "running" && (
          <span className="spin" style={{ fontSize: 10 }}>◌</span>
        )}
        {nodeData.executionStatus === "completed" && (
          <span style={{ fontSize: 10, color: "#16a34a" }}>✓</span>
        )}
        {nodeData.executionStatus === "failed" && (
          <span style={{ fontSize: 10, color: "#dc2626" }}>✗</span>
        )}
      </div>

      {/* Body - ports */}
      <div style={{ padding: "6px 0" }}>
        {/* Input ports */}
        {inputs.map((port) => (
          <div
            key={`in-${port.id}`}
            style={{
              position: "relative",
              padding: "3px 12px 3px 20px",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              style={{
                width: 10,
                height: 10,
                background: PORT_TYPE_COLORS[port.type] ?? PORT_TYPE_COLORS.any,
                border: "2px solid white",
                boxShadow: "0 0 0 1px " + (PORT_TYPE_COLORS[port.type] ?? PORT_TYPE_COLORS.any),
                left: -5,
                top: "50%",
                position: "absolute",
              }}
            />
            <span style={{ color: "#64748b", fontSize: 10 }}>{port.name}</span>
            <span
              style={{
                fontSize: 9,
                color: PORT_TYPE_COLORS[port.type] ?? PORT_TYPE_COLORS.any,
                marginLeft: "auto",
                opacity: 0.7,
              }}
            >
              {port.type}
            </span>
          </div>
        ))}

        {/* Divider if both inputs and outputs */}
        {inputs.length > 0 && outputs.length > 0 && (
          <div style={{ borderTop: "1px solid #f1f5f9", margin: "4px 12px" }} />
        )}

        {/* Output ports */}
        {outputs.map((port) => (
          <div
            key={`out-${port.id}`}
            style={{
              position: "relative",
              padding: "3px 20px 3px 12px",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ color: "#64748b", fontSize: 10 }}>{port.name}</span>
            <span
              style={{
                fontSize: 9,
                color: PORT_TYPE_COLORS[port.type] ?? PORT_TYPE_COLORS.any,
                marginLeft: "auto",
                opacity: 0.7,
              }}
            >
              {port.type}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{
                width: 10,
                height: 10,
                background: PORT_TYPE_COLORS[port.type] ?? PORT_TYPE_COLORS.any,
                border: "2px solid white",
                boxShadow: "0 0 0 1px " + (PORT_TYPE_COLORS[port.type] ?? PORT_TYPE_COLORS.any),
                right: -5,
                top: "50%",
                position: "absolute",
              }}
            />
          </div>
        ))}

        {/* No ports fallback */}
        {inputs.length === 0 && outputs.length === 0 && (
          <div style={{ padding: "4px 12px", color: "#94a3b8", fontSize: 10, fontStyle: "italic" }}>
            {nodeData.moduleType}
          </div>
        )}
      </div>

      {/* Default handles if no ports defined */}
      {inputs.length === 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          style={{
            width: 10,
            height: 10,
            background: PORT_TYPE_COLORS.any,
            border: "2px solid white",
            boxShadow: "0 0 0 1px " + PORT_TYPE_COLORS.any,
            top: "50%",
          }}
        />
      )}
      {outputs.length === 0 && (
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          style={{
            width: 10,
            height: 10,
            background: PORT_TYPE_COLORS.any,
            border: "2px solid white",
            boxShadow: "0 0 0 1px " + PORT_TYPE_COLORS.any,
            top: "50%",
          }}
        />
      )}
    </div>
  );
}

function getCategoryFromType(moduleType: string): string {
  if (moduleType.startsWith("llm-")) return "llm";
  if (moduleType.startsWith("io-")) return "io";
  if (moduleType.startsWith("code-")) return "code";
  if (moduleType.startsWith("flow-")) return "flow";
  if (moduleType.startsWith("data-")) return "data";
  if (moduleType.startsWith("tool-")) return "tool";
  return "tool";
}

function getStatusBorder(status?: string): string | null {
  switch (status) {
    case "running": return "#f59e0b";
    case "completed": return "#22c55e";
    case "failed": return "#ef4444";
    case "skipped": return "#94a3b8";
    default: return null;
  }
}

export const WorkflowNodeMemo = memo(WorkflowNodeComponent);
