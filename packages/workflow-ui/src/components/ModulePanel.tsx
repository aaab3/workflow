import { useState, useEffect, useMemo } from "react";
import { api, type ModuleMeta } from "../api/client";
import { useModulesStore } from "../stores/modules-store";
import { getModuleIcon } from "../utils/module-icons";

const CATEGORY_LABELS: Record<string, string> = {
  llm: "LLM 模型",
  io: "输入/输出",
  data: "数据处理",
  flow: "流程控制",
  code: "自定义代码",
  tool: "工具",
};

const CATEGORY_ORDER = ["llm", "io", "code", "flow", "data", "tool"];

const FALLBACK_MODULES: ModuleMeta[] = [
  { id: "io-text-input", name: "文字输入", category: "io", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
  { id: "llm-chat", name: "LLM 对话", category: "llm", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
  { id: "io-terminal", name: "终端/Agent", category: "io", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
  { id: "crew", name: "多 Agent 协作", category: "llm", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
  { id: "code-javascript", name: "JavaScript", category: "code", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
  { id: "flow-condition", name: "条件分支", category: "flow", description: "", icon: "", inputs: [], outputs: [], configSchema: {} },
];

export function ModulePanel() {
  const { modules, loaded, load } = useModulesStore();
  const [search, setSearch] = useState("");
  const [localModules, setLocalModules] = useState<ModuleMeta[]>([]);

  useEffect(() => {
    load().catch(() => {
      api.modules.list().then(setLocalModules).catch(() => setLocalModules(FALLBACK_MODULES));
    });
  }, [load]);

  const displayModules = loaded && modules.length > 0 ? modules : localModules;

  const filtered = useMemo(
    () =>
      displayModules.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.description?.toLowerCase().includes(search.toLowerCase())
      ),
    [displayModules, search]
  );

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    modules: filtered.filter((m) => m.category === cat),
  })).filter((g) => g.modules.length > 0);

  const onDragStart = (event: React.DragEvent, module: ModuleMeta) => {
    event.dataTransfer.setData("application/workflow-module", module.id);
    event.dataTransfer.setData("application/workflow-label", module.name);
    event.dataTransfer.setData("application/workflow-category", module.category);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="side-panel side-panel--left">
      <div style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 12,
              color: "var(--color-text-muted)",
              pointerEvents: "none",
            }}
          >
            🔍
          </span>
          <input
            type="text"
            className="input input--search"
            placeholder="搜索模块..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px" }}>
        {grouped.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", padding: 12, textAlign: "center" }}>
            无匹配模块
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.category}>
              <div className="category-label">{group.label}</div>
              {group.modules.map((module) => {
                const icon = getModuleIcon(module.id, module.category);
                return (
                  <div
                    key={module.id}
                    className="module-item"
                    draggable
                    onDragStart={(e) => onDragStart(e, module)}
                    title={module.description || module.id}
                  >
                    <span
                      className="module-item-icon"
                      style={{ background: icon.bg }}
                    >
                      {icon.emoji}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {module.name}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
