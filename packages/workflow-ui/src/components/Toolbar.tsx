import { useState, useEffect } from "react";
import { useWorkflowStore } from "../stores/workflow-store";
import { api, type ExecutionResult } from "../api/client";

interface ToolbarProps {
  onExecutionResult: (result: ExecutionResult) => void;
  onOpenList: () => void;
  onOpenGuide: () => void;
  onOpenHelp: () => void;
  onOpenCredentials: () => void;
}

export function Toolbar({ onExecutionResult, onOpenList, onOpenGuide, onOpenHelp, onOpenCredentials }: ToolbarProps) {
  const { workflowId, workflowName, toWorkflow, undo, redo, canUndo, canRedo } = useWorkflowStore();
  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState<string>("");

  // Keyboard shortcuts
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
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const handleSave = async () => {
    const data = toWorkflow();
    try {
      if (workflowId) {
        await api.workflows.update(workflowId, data);
        setStatus("已保存");
      } else {
        const created = await api.workflows.create(data);
        useWorkflowStore.getState().loadWorkflow(created);
        setStatus("已创建");
      }
      setTimeout(() => setStatus(""), 2000);
    } catch (err) {
      setStatus(`保存失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleRun = async () => {
    if (!workflowId) {
      setStatus("请先保存工作流");
      return;
    }
    setExecuting(true);
    setStatus("执行中...");
    try {
      const result = await api.workflows.execute(workflowId);
      setStatus(
        result.status === "completed"
          ? `✓ 完成 (${result.metrics.totalDuration}ms)`
          : `✗ ${result.status}`
      );
      onExecutionResult(result);
    } catch (err) {
      setStatus(`执行失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div style={{ height: 48, borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, background: "var(--color-surface)" }}>
      <button
        onClick={onOpenList}
        title="工作流列表"
        style={{ padding: "4px 10px", fontSize: 12, border: "1px solid var(--color-border)", borderRadius: 4, background: "white", cursor: "pointer" }}
      >
        📂 工作流
      </button>

      <h1 style={{ fontSize: 14, fontWeight: 600, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{workflowName}</h1>

      {/* Undo/Redo */}
      <div style={{ display: "flex", gap: 2, marginLeft: 12 }}>
        <button
          onClick={undo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
          style={{ padding: "4px 8px", fontSize: 14, border: "none", background: "transparent", cursor: canUndo ? "pointer" : "default", opacity: canUndo ? 1 : 0.3, borderRadius: 4 }}
        >
          ↩
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="重做 (Ctrl+Y)"
          style={{ padding: "4px 8px", fontSize: 14, border: "none", background: "transparent", cursor: canRedo ? "pointer" : "default", opacity: canRedo ? 1 : 0.3, borderRadius: 4 }}
        >
          ↪
        </button>
      </div>

      <div style={{ flex: 1 }} />

      {status && (
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{status}</span>
      )}

      <button
        onClick={onOpenCredentials}
        title="凭据管理"
        style={{ padding: "4px 8px", fontSize: 14, border: "none", background: "transparent", cursor: "pointer", borderRadius: 4 }}
      >
        🔐
      </button>

      <button
        onClick={onOpenHelp}
        title="使用说明书"
        style={{ padding: "4px 8px", fontSize: 14, border: "none", background: "transparent", cursor: "pointer", borderRadius: 4 }}
      >
        📖
      </button>

      <button
        onClick={onOpenGuide}
        title="新手教程"
        style={{ padding: "4px 8px", fontSize: 14, border: "none", background: "transparent", cursor: "pointer", borderRadius: 4 }}
      >
        ❓
      </button>

      <button
        onClick={handleSave}
        style={{ padding: "6px 12px", fontSize: 12, borderRadius: 4, background: "var(--color-surface-alt)", border: "1px solid var(--color-border)", cursor: "pointer" }}
      >
        保存
      </button>

      <button
        onClick={handleRun}
        disabled={executing}
        style={{ padding: "6px 12px", fontSize: 12, borderRadius: 4, background: "var(--color-primary)", color: "white", border: "none", cursor: executing ? "not-allowed" : "pointer", opacity: executing ? 0.5 : 1 }}
      >
        {executing ? "执行中..." : "▶ 运行"}
      </button>
    </div>
  );
}
