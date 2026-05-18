/**
 * Execution result panel - shows execution status, node outputs, and logs.
 */

import { useState } from "react";
import type { ExecutionResult } from "../api/client";

interface ExecutionPanelProps {
  result: ExecutionResult | null;
  onClose: () => void;
}

export function ExecutionPanel({ result, onClose }: ExecutionPanelProps) {
  const [activeTab, setActiveTab] = useState<"output" | "errors">("output");

  if (!result) return null;

  const isSuccess = result.status === "completed";
  const statusColor = isSuccess ? "#16a34a" : "#dc2626";
  const statusLabel = isSuccess ? "执行成功" : "执行失败";

  return (
    <div
      style={{
        height: 220,
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid var(--color-border)",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>
          {statusLabel}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {result.metrics.completedNodes}/{result.metrics.totalNodes} 节点完成
          {result.metrics.totalDuration != null && ` · ${result.metrics.totalDuration}ms`}
        </span>

        <div style={{ flex: 1 }} />

        {/* Tabs */}
        <button
          onClick={() => setActiveTab("output")}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            border: "none",
            background: activeTab === "output" ? "#e0e7ff" : "transparent",
            color: activeTab === "output" ? "#4f46e5" : "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          输出
        </button>
        {result.errors && result.errors.length > 0 && (
          <button
            onClick={() => setActiveTab("errors")}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 4,
              border: "none",
              background: activeTab === "errors" ? "#fee2e2" : "transparent",
              color: activeTab === "errors" ? "#dc2626" : "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            错误 ({result.errors.length})
          </button>
        )}

        <button
          onClick={onClose}
          style={{
            fontSize: 14,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {activeTab === "output" && result.outputs && (
          <pre
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              color: "var(--color-text)",
            }}
          >
            {JSON.stringify(result.outputs, null, 2)}
          </pre>
        )}

        {activeTab === "errors" && result.errors && (
          <div>
            {result.errors.map((err, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 10px",
                  marginBottom: 6,
                  background: "#fef2f2",
                  borderRadius: 4,
                  border: "1px solid #fecaca",
                  fontSize: 11,
                }}
              >
                <span style={{ fontWeight: 600, color: "#991b1b" }}>[{err.nodeId}]</span>{" "}
                <span style={{ color: "#dc2626" }}>{err.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
