/**
 * Workflow list panel - shows saved workflows, allows loading/creating/deleting.
 */

import { useState, useEffect } from "react";
import { api, type WorkflowSummary } from "../api/client";
import { useWorkflowStore } from "../stores/workflow-store";

interface WorkflowListProps {
  open: boolean;
  onClose: () => void;
}

export function WorkflowList({ open, onClose }: WorkflowListProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const { loadWorkflow, reset } = useWorkflowStore();

  useEffect(() => {
    if (open) {
      fetchWorkflows();
    }
  }, [open]);

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const list = await api.workflows.list();
      setWorkflows(list);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      const wf = await api.workflows.get(id);
      loadWorkflow(wf);
      onClose();
    } catch (err) {
      alert(`加载失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除工作流 "${name}"？`)) return;
    try {
      await api.workflows.delete(id);
      fetchWorkflows();
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleNew = () => {
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          width: 520,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>工作流列表</h2>
          <button
            onClick={handleNew}
            style={{ padding: "6px 14px", fontSize: 12, borderRadius: 6, background: "var(--color-primary)", color: "white", border: "none", cursor: "pointer", marginRight: 8 }}
          >
            + 新建
          </button>
          <button
            onClick={onClose}
            style={{ fontSize: 18, border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-muted)", padding: "0 4px" }}
          >
            ×
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          {loading && (
            <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 12, padding: 20 }}>
              加载中...
            </p>
          )}

          {!loading && workflows.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 12, padding: 20 }}>
              暂无工作流，点击"新建"创建第一个
            </p>
          )}

          {workflows.map((wf) => (
            <div
              key={wf.id}
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onClick={() => handleLoad(wf.id)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-alt)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{wf.name}</div>
                {wf.description && (
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                    {wf.description}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
                  {wf.nodeCount} 个节点 · v{wf.version} · {new Date(wf.updatedAt).toLocaleDateString()}
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(wf.id, wf.name);
                }}
                style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #fecaca", borderRadius: 4, color: "#dc2626", background: "white", cursor: "pointer" }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
