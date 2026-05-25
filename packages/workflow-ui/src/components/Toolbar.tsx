import { useCallback, useEffect, useState } from "react";
import { useWorkflowStore } from "../stores/workflow-store";
import { useExecutionStore } from "../stores/execution-store";
import { api } from "../api/client";

interface ToolbarProps {
  onOpenList: () => void;
  onOpenGuide: () => void;
  onOpenHelp: () => void;
  onOpenCredentials: () => void;
}

export function Toolbar({ onOpenList, onOpenGuide, onOpenHelp, onOpenCredentials }: ToolbarProps) {
  const { workflowId, workflowName, toWorkflow, undo, redo, canUndo, canRedo } = useWorkflowStore();
  const { isRunning, metrics, status, streamError, run, stopWatching, openPanel } = useExecutionStore();
  const [saveStatus, setSaveStatus] = useState("");

  const progressPct =
    metrics && metrics.totalNodes > 0
      ? Math.round(
          ((metrics.completedNodes + metrics.failedNodes + metrics.skippedNodes) / metrics.totalNodes) *
            100
        )
      : 0;

  const handleSave = useCallback(async () => {
    const data = toWorkflow();
    try {
      if (workflowId) {
        await api.workflows.update(workflowId, data);
        setSaveStatus("已保存");
      } else {
        const created = await api.workflows.create(data);
        useWorkflowStore.getState().loadWorkflow(created);
        setSaveStatus("已创建");
      }
      setTimeout(() => setSaveStatus(""), 2000);
    } catch (err) {
      setSaveStatus(`保存失败: ${err instanceof Error ? err.message : err}`);
    }
  }, [workflowId, toWorkflow]);

  const handleRun = useCallback(async () => {
    if (!workflowId) {
      setSaveStatus("请先保存工作流");
      setTimeout(() => setSaveStatus(""), 2500);
      return;
    }
    await run(workflowId);
  }, [workflowId, run]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !isRunning) {
        e.preventDefault();
        void handleRun();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, handleSave, handleRun, isRunning]);

  const statusLabel = () => {
    if (streamError) return streamError;
    if (isRunning && metrics) {
      return `执行中 ${metrics.completedNodes}/${metrics.totalNodes}`;
    }
    if (status === "completed") return "执行完成";
    if (status === "failed") return "执行失败";
    return saveStatus;
  };

  return (
    <header className="toolbar">
      <div className="toolbar-brand">
        <div className="toolbar-logo" aria-hidden>
          ⚡
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenList} title="工作流列表">
          工作流
        </button>
        <div className="toolbar-divider" />
        <h1 className="toolbar-title" title={workflowName}>
          {workflowName}
        </h1>
      </div>

      <div className="toolbar-divider" />

      <div style={{ display: "flex", gap: 2 }}>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={undo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={redo}
          disabled={!canRedo}
          title="重做 (Ctrl+Y)"
        >
          ↪
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-status">
        {isRunning && (
          <div className="toolbar-progress" title={`${progressPct}%`}>
            <div className="toolbar-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
        {statusLabel() && (
          <span style={{ color: streamError ? "var(--color-danger)" : undefined }}>{statusLabel()}</span>
        )}
      </div>

      <button type="button" className="btn btn--ghost btn--icon" onClick={onOpenCredentials} title="凭据管理">
        🔐
      </button>
      <button type="button" className="btn btn--ghost btn--icon" onClick={onOpenHelp} title="使用说明书">
        📖
      </button>
      <button type="button" className="btn btn--ghost btn--icon" onClick={onOpenGuide} title="新手教程">
        ❓
      </button>

      {isRunning && (
        <button type="button" className="btn btn--sm" onClick={() => { stopWatching(); openPanel(); }}>
          停止监视
        </button>
      )}

      <button type="button" className="btn" onClick={() => void handleSave()}>
        保存
      </button>

      <button
        type="button"
        className="btn btn--primary"
        onClick={() => void handleRun()}
        disabled={isRunning}
        title="运行 (Ctrl+Enter)"
      >
        {isRunning ? (
          <>
            <span className="spin" style={{ display: "inline-block" }}>
              ◌
            </span>
            执行中...
          </>
        ) : (
          <>▶ 运行</>
        )}
      </button>
    </header>
  );
}
