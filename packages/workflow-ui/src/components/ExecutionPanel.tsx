import { useMemo, useState } from "react";
import { useExecutionStore, type NodeExecStatus } from "../stores/execution-store";
import { useWorkflowStore } from "../stores/workflow-store";

type TabId = "progress" | "output" | "logs" | "errors";

const STATUS_LABELS: Record<NodeExecStatus, string> = {
  pending: "等待",
  running: "运行中",
  completed: "完成",
  failed: "失败",
  skipped: "跳过",
};

export function ExecutionPanel() {
  const {
    panelOpen,
    isRunning,
    result,
    metrics,
    nodeStatuses,
    logs,
    streamError,
    executionId,
    status,
    closePanel,
  } = useExecutionStore();
  const nodes = useWorkflowStore((s) => s.nodes);
  const [activeTab, setActiveTab] = useState<TabId>("progress");

  const nodeRows = useMemo(() => {
    return nodes.map((n) => {
      const label = (n.data.label as string) ?? n.id;
      const st = nodeStatuses[n.id] ?? "pending";
      return { id: n.id, label, status: st };
    });
  }, [nodes, nodeStatuses]);

  const labeledOutputs = useMemo(() => {
    if (!result?.outputs) return null;
    return Object.fromEntries(
      Object.entries(result.outputs).map(([nodeId, output]) => {
        const node = nodes.find((n) => n.id === nodeId);
        const label = (node?.data.label as string) ?? nodeId;
        return [`${label} (${nodeId.slice(0, 8)}…)`, output];
      })
    );
  }, [result?.outputs, nodes]);

  if (!panelOpen) return null;

  const isSuccess = status === "completed" || result?.status === "completed";
  const isFailed = status === "failed" || result?.status === "failed";
  const headerColor = isRunning
    ? "var(--color-warning)"
    : isSuccess
      ? "var(--color-success)"
      : isFailed
        ? "var(--color-danger)"
        : "var(--color-text-muted)";

  const headerText = isRunning
    ? "执行中"
    : isSuccess
      ? "执行成功"
      : isFailed
        ? "执行失败"
        : streamError
          ? "连接异常"
          : "执行状态";

  const errors = result?.errors ?? [];
  const hasErrors = errors.length > 0;

  return (
    <div className={`execution-panel execution-panel--open`}>
      <div className="execution-header">
        <span style={{ fontSize: 13, fontWeight: 600, color: headerColor }}>{headerText}</span>

        {metrics && (
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            {metrics.completedNodes}/{metrics.totalNodes} 节点
            {metrics.failedNodes > 0 && ` · ${metrics.failedNodes} 失败`}
            {metrics.totalDuration != null && ` · ${metrics.totalDuration}ms`}
          </span>
        )}

        {executionId && (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
            title={executionId}
          >
            {executionId.slice(0, 8)}…
          </span>
        )}

        <div style={{ flex: 1 }} />

        <div className="execution-tabs">
          <button
            type="button"
            className={`execution-tab ${activeTab === "progress" ? "execution-tab--active" : ""}`}
            onClick={() => setActiveTab("progress")}
          >
            进度
          </button>
          <button
            type="button"
            className={`execution-tab ${activeTab === "output" ? "execution-tab--active" : ""}`}
            onClick={() => setActiveTab("output")}
          >
            输出
          </button>
          <button
            type="button"
            className={`execution-tab ${activeTab === "logs" ? "execution-tab--active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            日志 {logs.length > 0 && `(${logs.length})`}
          </button>
          {hasErrors && (
            <button
              type="button"
              className={`execution-tab ${activeTab === "errors" ? "execution-tab--active" : ""}`}
              onClick={() => setActiveTab("errors")}
              style={activeTab === "errors" ? { background: "#fee2e2", color: "#dc2626" } : undefined}
            >
              错误 ({errors.length})
            </button>
          )}
        </div>

        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={closePanel}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      <div className="execution-body">
        {activeTab === "progress" && (
          <div>
            {nodeRows.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>画布上没有节点</p>
            ) : (
              nodeRows.map((row) => (
                <div key={row.id} className="node-progress-row">
                  <span className={`status-dot status-dot--${row.status}`} />
                  <span style={{ flex: 1, fontWeight: 500 }}>{row.label}</span>
                  <span style={{ color: "var(--color-text-muted)" }}>{STATUS_LABELS[row.status]}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {row.id.slice(0, 8)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "output" && (
          <>
            {labeledOutputs && Object.keys(labeledOutputs).length > 0 ? (
              <pre
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {JSON.stringify(labeledOutputs, null, 2)}
              </pre>
            ) : (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {isRunning ? "执行完成后显示输出…" : "无输出数据"}
              </p>
            )}
          </>
        )}

        {activeTab === "logs" && (
          <>
            {logs.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {isRunning ? "等待日志事件…" : "无日志"}
              </p>
            ) : (
              logs.map((line) => (
                <div
                  key={line.id}
                  className={`log-line log-line--${line.level}`}
                >
                  <span style={{ color: "var(--color-text-muted)", marginRight: 8 }}>
                    {new Date(line.timestamp).toLocaleTimeString()}
                  </span>
                  {line.nodeId && (
                    <span style={{ color: "var(--color-primary)", marginRight: 8 }}>
                      [{line.nodeId.slice(0, 8)}]
                    </span>
                  )}
                  {line.message}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "errors" && hasErrors && (
          <div>
            {errors.map((err, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 12px",
                  marginBottom: 6,
                  background: "#fef2f2",
                  borderRadius: 6,
                  border: "1px solid #fecaca",
                  fontSize: 12,
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
