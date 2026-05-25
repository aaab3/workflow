/**
 * Workflow list panel - shows saved workflows, allows loading/creating/deleting.
 */

import { useState, useEffect } from "react";
import { api, type WorkflowSummary } from "../api/client";
import { useWorkflowStore } from "../stores/workflow-store";
import { useExecutionStore } from "../stores/execution-store";

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
      const sorted = [...list].sort((a, b) => {
        const aTpl = a.description?.startsWith("【官方模板】") ? 0 : 1;
        const bTpl = b.description?.startsWith("【官方模板】") ? 0 : 1;
        if (aTpl !== bTpl) return aTpl - bTpl;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      setWorkflows(sorted);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      const wf = await api.workflows.get(id);
      useExecutionStore.getState().reset();
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
    useExecutionStore.getState().reset();
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ width: 520, maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>工作流列表</h2>
          <button type="button" className="btn btn--primary btn--sm" onClick={handleNew} style={{ marginRight: 8 }}>
            + 新建
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="关闭">
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
              暂无工作流。重启后端将自动导入 10 个官方模板，或点击「新建」创建。
            </p>
          )}

          {!loading && workflows.some((w) => w.description?.startsWith("【官方模板】")) && (
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "4px 12px 8px", margin: 0 }}>
              以下为内置官方模板，可直接打开运行测试。
            </p>
          )}

          {workflows.map((wf) => {
            const isTemplate = wf.description?.startsWith("【官方模板】");
            return (
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
                <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                  {wf.name}
                  {isTemplate && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "var(--color-primary-muted)",
                        color: "var(--color-primary)",
                        fontWeight: 600,
                      }}
                    >
                      模板
                    </span>
                  )}
                </div>
                {wf.description && (
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                    {isTemplate ? wf.description.replace("【官方模板】", "") : wf.description}
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
          );
          })}
        </div>
      </div>
    </div>
  );
}
