import { useState, useEffect } from "react";
import { api, type ModuleMeta } from "../api/client";

const CATEGORY_LABELS: Record<string, string> = {
  llm: "LLM 模型",
  io: "输入/输出",
  data: "数据处理",
  flow: "流程控制",
  code: "自定义代码",
  tool: "工具",
};

const CATEGORY_ORDER = ["llm", "io", "code", "flow", "data", "tool"];

export function ModulePanel() {
  const [modules, setModules] = useState<ModuleMeta[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.modules.list().then(setModules).catch(() => {
      // Fallback: use hardcoded module list when server is not available
      setModules([
        { id: "llm-chat", name: "LLM 对话", category: "llm", description: "调用 LLM 对话补全", icon: "message-square", inputs: [], outputs: [], configSchema: {} },
        { id: "io-file-read", name: "读取文件", category: "io", description: "读取本地文件", icon: "file-input", inputs: [], outputs: [], configSchema: {} },
        { id: "io-file-write", name: "写入文件", category: "io", description: "写入本地文件", icon: "file-output", inputs: [], outputs: [], configSchema: {} },
        { id: "io-http-request", name: "HTTP 请求", category: "io", description: "发送 HTTP 请求", icon: "globe", inputs: [], outputs: [], configSchema: {} },
        { id: "io-terminal", name: "终端/Agent", category: "io", description: "执行终端命令或调用外部 Agent", icon: "terminal", inputs: [], outputs: [], configSchema: {} },
        { id: "crew", name: "多Agent协作", category: "llm", description: "多Agent团队协作（辩论/反思/流水线等）", icon: "users", inputs: [], outputs: [], configSchema: {} },
        { id: "code-javascript", name: "JavaScript", category: "code", description: "执行 JS 代码", icon: "code", inputs: [], outputs: [], configSchema: {} },
        { id: "flow-condition", name: "条件分支", category: "flow", description: "if/else 分支", icon: "git-branch", inputs: [], outputs: [], configSchema: {} },
        { id: "flow-delay", name: "延时等待", category: "flow", description: "暂停执行", icon: "clock", inputs: [], outputs: [], configSchema: {} },
      ]);
    });
  }, []);

  const filtered = modules.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      modules: filtered.filter((m) => m.category === cat),
    }))
    .filter((g) => g.modules.length > 0);

  const onDragStart = (event: React.DragEvent, module: ModuleMeta) => {
    event.dataTransfer.setData("application/workflow-module", module.id);
    event.dataTransfer.setData("application/workflow-label", module.name);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div style={{ width: 220, borderRight: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
        <input
          type="text"
          placeholder="搜索模块..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", padding: "6px 8px", fontSize: 12, border: "1px solid var(--color-border)", borderRadius: 4, outline: "none" }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {grouped.map((group) => (
          <div key={group.category} style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-muted)", padding: "0 4px", marginBottom: 4 }}>
              {group.label}
            </h3>
            {group.modules.map((module) => (
              <div
                key={module.id}
                draggable
                onDragStart={(e) => onDragStart(e, module)}
                style={{ padding: "6px 8px", fontSize: 12, borderRadius: 4, cursor: "grab", marginBottom: 2 }}
                className="hover:bg-[var(--color-surface-alt)]"
                title={module.description}
              >
                {module.name}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
