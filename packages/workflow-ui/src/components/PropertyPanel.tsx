import { useWorkflowStore } from "../stores/workflow-store";
import { useModulesStore } from "../stores/modules-store";
import { getModuleSchema } from "../stores/module-schemas";
import { SchemaForm } from "./SchemaForm";

export function PropertyPanel() {
  const { nodes, selectedNodeId, updateNodeData, removeNode } = useWorkflowStore();
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const moduleType = (selectedNode?.data as Record<string, unknown> | undefined)?.moduleType as string ?? "";
  const serverMeta = useModulesStore((s) => (moduleType ? s.get(moduleType) : undefined));

  if (!selectedNode) {
    return (
      <aside className="side-panel side-panel--right">
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 32, opacity: 0.25, marginBottom: 12 }}>◇</span>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
            点击画布上的节点
          </p>
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
            查看并编辑配置
          </p>
        </div>
      </aside>
    );
  }

  const data = selectedNode.data as Record<string, unknown>;
  const config = (data.config as Record<string, unknown>) ?? {};
  const localSchema = getModuleSchema(moduleType);
  const serverProps = (serverMeta?.configSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  const schema =
    serverProps && Object.keys(serverProps).length > 0
      ? { configSchema: serverMeta!.configSchema }
      : localSchema;
  const category = (data.category as string) ?? moduleType.split("-")[0];

  return (
    <aside className="side-panel side-panel--right">
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>节点配置</h3>
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            margin: "4px 0 0",
            fontFamily: "var(--font-mono)",
          }}
        >
          {moduleType}
          {category && (
            <span
              style={{
                marginLeft: 8,
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--color-surface-alt)",
                fontFamily: "inherit",
              }}
            >
              {category}
            </span>
          )}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 500, display: "block", marginBottom: 6 }}>
          显示名称
        </label>
        <input
          type="text"
          className="input"
          value={(data.label as string) ?? ""}
          onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
          style={{ marginBottom: 16 }}
        />

        <div style={{ borderTop: "1px solid var(--color-border)", margin: "16px 0" }} />

        {schema ? (
          <SchemaForm schema={schema.configSchema} values={config} onChange={(key, value) => {
            updateNodeData(selectedNode.id, { config: { ...config, [key]: value } });
          }} />
        ) : (
          <div>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 10 }}>
              使用服务端模块 schema；当前显示原始配置
            </p>
            {Object.entries(config).map(([key, value]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>
                  {key}
                </label>
                <input
                  type="text"
                  className="input"
                  value={String(value ?? "")}
                  onChange={(e) =>
                    updateNodeData(selectedNode.id, { config: { ...config, [key]: e.target.value } })
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--color-border)", margin: "16px 0" }} />

        <label style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>
          节点 ID
        </label>
        <input
          type="text"
          className="input"
          value={selectedNode.id}
          readOnly
          style={{ fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--color-surface-alt)" }}
        />
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--color-border)" }}>
        <button type="button" className="btn btn--danger" style={{ width: "100%" }} onClick={() => removeNode(selectedNode.id)}>
          删除节点
        </button>
      </div>
    </aside>
  );
}
