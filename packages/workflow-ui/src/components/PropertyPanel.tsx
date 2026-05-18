/**
 * Property panel - shows node configuration using schema-driven forms.
 */

import { useWorkflowStore } from "../stores/workflow-store";
import { getModuleSchema } from "../stores/module-schemas";
import { SchemaForm } from "./SchemaForm";

export function PropertyPanel() {
  const { nodes, selectedNodeId, updateNodeData, removeNode } = useWorkflowStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div style={{ width: 280, borderLeft: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>选择节点查看属性</p>
      </div>
    );
  }

  const data = selectedNode.data as Record<string, unknown>;
  const moduleType = (data.moduleType as string) ?? "";
  const config = (data.config as Record<string, unknown>) ?? {};
  const schema = getModuleSchema(moduleType);

  const handleLabelChange = (label: string) => {
    updateNodeData(selectedNode.id, { label });
  };

  const handleConfigChange = (key: string, value: unknown) => {
    const newConfig = { ...config, [key]: value };
    updateNodeData(selectedNode.id, { config: newConfig });
  };

  return (
    <div style={{ width: 280, borderLeft: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>节点配置</h3>
        <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "2px 0 0" }}>
          {moduleType}
        </p>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {/* Label field */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text)", display: "block", marginBottom: 4 }}>
            显示名称
          </label>
          <input
            type="text"
            value={(data.label as string) ?? ""}
            onChange={(e) => handleLabelChange(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", fontSize: 12, border: "1px solid var(--color-border)", borderRadius: 4, outline: "none" }}
          />
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--color-border)", margin: "12px 0" }} />

        {/* Schema-driven config form */}
        {schema ? (
          <SchemaForm
            schema={schema.configSchema}
            values={config}
            onChange={handleConfigChange}
          />
        ) : (
          /* Fallback: raw key-value editor for unknown modules */
          <div>
            <p style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 8 }}>
              未知模块类型，显示原始配置
            </p>
            {Object.entries(config).map(([key, value]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>
                  {key}
                </label>
                <input
                  type="text"
                  value={String(value ?? "")}
                  onChange={(e) => handleConfigChange(key, e.target.value)}
                  style={{ width: "100%", padding: "4px 8px", fontSize: 12, border: "1px solid var(--color-border)", borderRadius: 4, outline: "none" }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Node ID (read-only) */}
        <div style={{ borderTop: "1px solid var(--color-border)", margin: "12px 0" }} />
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>
            节点 ID
          </label>
          <input
            type="text"
            value={selectedNode.id}
            readOnly
            style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid var(--color-border)", borderRadius: 4, background: "#f9fafb", color: "var(--color-text-muted)", fontFamily: "monospace" }}
          />
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ padding: 12, borderTop: "1px solid var(--color-border)" }}>
        <button
          onClick={() => removeNode(selectedNode.id)}
          style={{ width: "100%", padding: "6px 12px", fontSize: 12, borderRadius: 4, border: "1px solid #fecaca", color: "#dc2626", background: "white", cursor: "pointer" }}
        >
          删除节点
        </button>
      </div>
    </div>
  );
}
