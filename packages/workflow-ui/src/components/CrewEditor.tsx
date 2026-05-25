/**
 * Crew Editor — Full-screen visual editor for multi-agent collaboration.
 * Opens when user double-clicks a Crew node.
 *
 * Layout:
 * - Top: Mode selector + global settings
 * - Left: Agent card list (add/remove/reorder)
 * - Center: Agent connection canvas (mini React Flow)
 * - Right: Selected agent config panel
 * - Bottom: Generated JSON preview
 */

import { useState, useCallback } from "react";

interface AgentConfig {
  id: string;
  role: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  systemPrompt: string;
  contextMode: "shared" | "isolated" | "selective";
  temperature: number;
  maxTokens: number;
}

interface CrewEditorProps {
  open: boolean;
  initialAgents?: AgentConfig[];
  initialMode?: string;
  initialContext?: string;
  onSave: (config: { mode: string; agents: AgentConfig[]; contextStrategy: string; maxRounds: number; qualityThreshold: number }) => void;
  onClose: () => void;
}

const DEFAULT_AGENT: AgentConfig = {
  id: "",
  role: "",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  systemPrompt: "",
  contextMode: "shared",
  temperature: 0.7,
  maxTokens: 2048,
};

// Suggested models — UI shows these in a datalist, but users can type anything.
// Updated for late-2024/2025 model lineup; covers OpenAI, Anthropic, DeepSeek, local.
const MODEL_SUGGESTIONS: Array<{ value: string; label: string; cost: string }> = [
  { value: "gpt-4o", label: "GPT-4o", cost: "$$$" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini (推荐)", cost: "$" },
  { value: "o1", label: "OpenAI o1", cost: "$$$$" },
  { value: "o1-mini", label: "OpenAI o1-mini", cost: "$$" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", cost: "$$$" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", cost: "$" },
  { value: "deepseek-chat", label: "DeepSeek Chat", cost: "$" },
  { value: "deepseek-reasoner", label: "DeepSeek R1", cost: "$" },
  { value: "qwen2.5", label: "Qwen 2.5 (本地)", cost: "免费" },
  { value: "llama3.3", label: "Llama 3.3 (本地)", cost: "免费" },
];

const MODES = [
  { value: "auto", label: "🤖 自动判断", desc: "AI 根据任务自动选择最优模式" },
  { value: "pipeline", label: "➡️ 流水线", desc: "A→B→C 顺序执行" },
  { value: "parallel", label: "⚡ 并行", desc: "所有 Agent 同时执行" },
  { value: "reflect", label: "🔄 反思", desc: "生成→自检→修正循环" },
  { value: "moa", label: "🗳️ 投票", desc: "多 Agent 各自回答，综合最佳" },
  { value: "debate", label: "⚔️ 辩论", desc: "正反方辩论，裁判决定" },
  { value: "hierarchy", label: "👑 层级", desc: "Lead 拆解任务，Workers 执行" },
];

export function CrewEditor({ open, initialAgents, initialMode, initialContext, onSave, onClose }: CrewEditorProps) {
  const [agents, setAgents] = useState<AgentConfig[]>(initialAgents ?? [
    { ...DEFAULT_AGENT, id: "agent-1", role: "助手", baseUrl: "https://api.openai.com/v1", apiKey: "", systemPrompt: "你是一个有帮助的助手。" },
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(agents[0]?.id ?? null);
  const [mode, setMode] = useState(initialMode ?? "auto");
  const [contextStrategy, setContextStrategy] = useState(initialContext ?? "shared");
  const [maxRounds, setMaxRounds] = useState(3);
  const [qualityThreshold] = useState(7);

  const selectedAgent = agents.find((a) => a.id === selectedId);

  // When mode changes, update agent prompts to match the mode
  const handleModeChange = useCallback((newMode: string) => {
    setMode(newMode);
    const templates = getModeTemplates(newMode, agents.length);
    if (templates.length > 0) {
      setAgents(agents.map((a, i) => {
        const tmpl = templates[i];
        if (!tmpl) return a;
        // Only update if prompt is empty or was a previous template
        const isDefault = !a.systemPrompt || a.systemPrompt.startsWith("你是");
        return isDefault ? { ...a, role: tmpl.role, systemPrompt: tmpl.prompt } : a;
      }));
    }
  }, [agents]);

  const addAgent = useCallback(() => {
    const newAgent: AgentConfig = {
      ...DEFAULT_AGENT,
      id: `agent-${Date.now()}`,
      role: `Agent ${agents.length + 1}`,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      systemPrompt: "你是一个专业的助手。",
    };
    setAgents([...agents, newAgent]);
    setSelectedId(newAgent.id);
  }, [agents]);

  const removeAgent = useCallback((id: string) => {
    const filtered = agents.filter((a) => a.id !== id);
    setAgents(filtered);
    if (selectedId === id) setSelectedId(filtered[0]?.id ?? null);
  }, [agents, selectedId]);

  const updateAgent = useCallback((id: string, updates: Partial<AgentConfig>) => {
    setAgents(agents.map((a) => a.id === id ? { ...a, ...updates } : a));
  }, [agents]);

  const handleSave = () => {
    onSave({ mode, agents, contextStrategy, maxRounds, qualityThreshold });
  };

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "white", zIndex: 3000, display: "flex", flexDirection: "column" }}>
      {/* Top Bar */}
      <div style={{ height: 56, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 20px", gap: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>🤝 多 Agent 协作配置</h2>
        <div style={{ flex: 1 }} />

        {/* Mode selector */}
        <label style={{ fontSize: 12, color: "#64748b" }}>协作模式:</label>
        <select value={mode} onChange={(e) => handleModeChange(e.target.value)} style={{ padding: "4px 8px", fontSize: 12, borderRadius: 4, border: "1px solid #e2e8f0" }}>
          {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>

        {/* Context strategy */}
        <label style={{ fontSize: 12, color: "#64748b" }}>上下文:</label>
        <select value={contextStrategy} onChange={(e) => setContextStrategy(e.target.value)} style={{ padding: "4px 8px", fontSize: 12, borderRadius: 4, border: "1px solid #e2e8f0" }}>
          <option value="shared">全共享</option>
          <option value="isolated">各自独立</option>
          <option value="selective">选择性共享</option>
        </select>

        {(mode === "reflect" || mode === "debate") && (
          <>
            <label style={{ fontSize: 12, color: "#64748b" }}>轮次:</label>
            <input type="number" value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} min={1} max={10} style={{ width: 50, padding: "4px", fontSize: 12, borderRadius: 4, border: "1px solid #e2e8f0" }} />
          </>
        )}

        <button onClick={handleSave} style={{ padding: "6px 16px", fontSize: 12, borderRadius: 6, background: "#6366f1", color: "white", border: "none", cursor: "pointer", fontWeight: 500 }}>
          保存配置
        </button>
        <button onClick={onClose} style={{ padding: "6px 12px", fontSize: 14, border: "none", background: "transparent", cursor: "pointer", color: "#64748b" }}>✕</button>
      </div>

      {/* Mode description */}
      <div style={{ padding: "8px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" }}>
        {MODES.find((m) => m.value === mode)?.desc}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Agent list */}
        <div style={{ width: 240, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Agent 团队 ({agents.length})</span>
            <button onClick={addAgent} style={{ fontSize: 18, border: "none", background: "transparent", cursor: "pointer", color: "#6366f1" }}>+</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {agents.map((agent, idx) => (
              <div
                key={agent.id}
                onClick={() => setSelectedId(agent.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  marginBottom: 6,
                  border: selectedId === agent.id ? "2px solid #6366f1" : "1px solid #e2e8f0",
                  background: selectedId === agent.id ? "#eef2ff" : "white",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600 }}>{agent.role || `Agent ${idx + 1}`}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{MODEL_SUGGESTIONS.find((m) => m.value === agent.model)?.label ?? agent.model}</div>
                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
                  上下文: {agent.contextMode === "shared" ? "共享" : agent.contextMode === "isolated" ? "独立" : "选择性"}
                </div>
                {agents.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAgent(agent.id); }}
                    style={{ position: "absolute", top: 6, right: 6, fontSize: 12, border: "none", background: "transparent", cursor: "pointer", color: "#ef4444" }}
                  >×</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Center: Agent flow canvas */}
        <div style={{ flex: 1, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#fafbfc" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 11, fontWeight: 600, color: "#64748b" }}>
            Agent 流程图（连线定义数据流向）
          </div>
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <CrewCanvas agents={agents} mode={mode} />
          </div>
        </div>

        {/* Right: Agent config */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {selectedAgent ? (
            <div style={{ maxWidth: 600 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px" }}>配置: {selectedAgent.role}</h3>

              {/* Role */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>角色名称</label>
                <input
                  value={selectedAgent.role}
                  onChange={(e) => updateAgent(selectedAgent.id, { role: e.target.value })}
                  placeholder="如：翻译专家、代码审查员、产品经理"
                  style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6 }}
                />
              </div>

              {/* Model */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>
                  模型
                </label>
                <input
                  type="text"
                  value={selectedAgent.model}
                  onChange={(e) => updateAgent(selectedAgent.id, { model: e.target.value })}
                  list="crew-model-suggestions"
                  placeholder="如 gpt-4o-mini, claude-3-5-sonnet, qwen2.5..."
                  style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6, fontFamily: "monospace" }}
                />
                <datalist id="crew-model-suggestions">
                  {MODEL_SUGGESTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{`${m.label} (${m.cost})`}</option>
                  ))}
                </datalist>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>
                  可手动输入任何后端支持的模型 ID（OpenAI 兼容 API）
                </div>
              </div>

              {/* API URL */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>API 地址</label>
                <input
                  value={selectedAgent.baseUrl}
                  onChange={(e) => updateAgent(selectedAgent.id, { baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  style={{ width: "100%", padding: "8px 12px", fontSize: 12, border: "1px solid #e2e8f0", borderRadius: 6, fontFamily: "monospace" }}
                />
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>OpenAI: https://api.openai.com/v1 | Ollama: http://localhost:11434/v1</div>
              </div>

              {/* API Key */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>API Key</label>
                <input
                  type="password"
                  value={selectedAgent.apiKey}
                  onChange={(e) => updateAgent(selectedAgent.id, { apiKey: e.target.value })}
                  placeholder="sk-... (留空则使用环境变量 OPENAI_API_KEY)"
                  style={{ width: "100%", padding: "8px 12px", fontSize: 12, border: "1px solid #e2e8f0", borderRadius: 6, fontFamily: "monospace" }}
                />
              </div>

              {/* System Prompt */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>系统提示词（告诉 Agent 它是谁、该做什么）</label>
                <textarea
                  value={selectedAgent.systemPrompt}
                  onChange={(e) => updateAgent(selectedAgent.id, { systemPrompt: e.target.value })}
                  rows={6}
                  placeholder="你是一个专业的翻译官，擅长中英互译..."
                  style={{ width: "100%", padding: "8px 12px", fontSize: 12, border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical", lineHeight: 1.6 }}
                />
              </div>

              {/* Context Mode */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>上下文策略（这个 Agent 能看到什么）</label>
                <select
                  value={selectedAgent.contextMode}
                  onChange={(e) => updateAgent(selectedAgent.id, { contextMode: e.target.value as AgentConfig["contextMode"] })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6 }}
                >
                  <option value="shared">共享 — 能看到所有 Agent 的消息</option>
                  <option value="isolated">独立 — 只能看到自己的输入输出</option>
                  <option value="selective">选择性 — 只能看到指定 Agent 的消息</option>
                </select>
              </div>

              {/* Temperature */}
              <div style={{ marginBottom: 16, display: "flex", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>温度 ({selectedAgent.temperature})</label>
                  <input
                    type="range" min={0} max={2} step={0.1}
                    value={selectedAgent.temperature}
                    onChange={(e) => updateAgent(selectedAgent.id, { temperature: Number(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>最大 Token</label>
                  <input
                    type="number" min={256} max={128000}
                    value={selectedAgent.maxTokens}
                    onChange={(e) => updateAgent(selectedAgent.id, { maxTokens: Number(e.target.value) })}
                    style={{ width: "100%", padding: "6px 8px", fontSize: 12, border: "1px solid #e2e8f0", borderRadius: 4 }}
                  />
                </div>
              </div>

              {/* Preview JSON */}
              <div style={{ marginTop: 24, padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>生成的配置预览</div>
                <pre style={{ fontSize: 10, margin: 0, overflow: "auto", maxHeight: 150, color: "#374151" }}>
                  {JSON.stringify({ mode, contextStrategy, maxRounds, agents: agents.map((a) => ({ id: a.id, role: a.role, model: { name: a.model }, systemPrompt: a.systemPrompt.slice(0, 50) + "...", context: { mode: a.contextMode } })) }, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8" }}>
              点击左侧 Agent 卡片进行配置
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/**
 * Mini React Flow canvas showing Agent nodes and their connections.
 * Auto-generates layout based on the selected mode.
 */
function CrewCanvas({ agents, mode }: { agents: AgentConfig[]; mode: string }) {
  // Generate nodes from agents
  const nodes = agents.map((agent, idx) => {
    const pos = getNodePosition(idx, agents.length, mode);
    return {
      id: agent.id,
      position: pos,
      data: { label: agent.role || `Agent ${idx + 1}`, model: agent.model },
    };
  });

  // Generate edges based on mode
  const edges = generateEdges(agents, mode);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Simple SVG-based flow visualization */}
      <svg width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0 }}>
        {/* Draw edges */}
        {edges.map((edge, i) => {
          const fromNode = nodes.find((n) => n.id === edge.from);
          const toNode = nodes.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;
          const x1 = fromNode.position.x + 70;
          const y1 = fromNode.position.y + 25;
          const x2 = toNode.position.x;
          const y2 = toNode.position.y + 25;
          const midX = (x1 + x2) / 2;
          return (
            <g key={i}>
              <path
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={edge.type === "debate" ? "#f59e0b" : "#6366f1"}
                strokeWidth={2}
                strokeDasharray={edge.type === "debate" ? "4 4" : "none"}
                markerEnd="url(#arrowhead)"
              />
              {edge.label && (
                <text x={midX} y={(y1 + y2) / 2 - 8} textAnchor="middle" fontSize={9} fill="#64748b">{edge.label}</text>
              )}
            </g>
          );
        })}
        {/* Arrow marker */}
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
          </marker>
        </defs>
      </svg>

      {/* Draw nodes */}
      {nodes.map((node) => (
        <div
          key={node.id}
          style={{
            position: "absolute",
            left: node.position.x,
            top: node.position.y,
            width: 140,
            padding: "8px 12px",
            background: "white",
            border: "2px solid #6366f1",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            textAlign: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <div>{node.data.label}</div>
          <div style={{ fontSize: 9, color: "#64748b", fontWeight: 400, marginTop: 2 }}>
            {node.data.model.split("-").slice(0, 2).join("-")}
          </div>
        </div>
      ))}

      {/* Parallel mode: show execution hint */}
      {mode === "parallel" && nodes.length > 2 && (
        <div style={{ position: "absolute", right: 8, top: 8, fontSize: 9, color: "#6366f1", background: "#eef2ff", padding: "3px 8px", borderRadius: 4 }}>
          ⚡ Workers 并行执行
        </div>
      )}

      {/* Mode hint */}
      <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 10, color: "#94a3b8" }}>
        {mode === "pipeline" && "➡️ 顺序执行：数据从左到右流动"}
        {mode === "parallel" && "⚡ 并行执行：所有 Agent 同时运行"}
        {mode === "debate" && "⚔️ 辩论模式：Agent 互相看到对方观点"}
        {mode === "reflect" && "🔄 反思模式：生成 → 审查 → 修改循环"}
        {mode === "moa" && "🗳️ 投票模式：各自回答，最后综合"}
        {mode === "hierarchy" && "👑 层级模式：第一个 Agent 是 Lead"}
        {mode === "auto" && "🤖 自动模式：AI 根据任务选择最优方式"}
      </div>
    </div>
  );
}

function getNodePosition(idx: number, total: number, mode: string): { x: number; y: number } {
  const padding = 40;
  const nodeWidth = 140;

  switch (mode) {
    case "pipeline":
      return { x: padding + idx * (nodeWidth + 60), y: 80 };
    case "parallel":
      // Dispatcher at top-left, workers in middle row, merger at bottom-right
      if (total <= 2) return { x: padding + idx * (nodeWidth + 60), y: 80 };
      if (idx === 0) return { x: 40, y: 30 }; // Dispatcher top-left
      if (idx === total - 1) return { x: 40 + (total - 2) * (nodeWidth + 10) / 2, y: 160 }; // Merger bottom-center
      return { x: padding + (idx - 1) * (nodeWidth + 10), y: 80 }; // Workers middle row
    case "debate":
      if (total <= 2) return { x: padding + idx * 250, y: 80 };
      if (idx < total - 1) return { x: padding + idx * 200, y: 40 };
      return { x: padding + ((total - 2) * 200) / 2, y: 140 }; // Judge at bottom center
    case "reflect":
      return { x: padding + idx * 250, y: 80 };
    case "hierarchy":
      if (idx === 0) return { x: 200, y: 30 }; // Lead at top center
      return { x: padding + (idx - 1) * (nodeWidth + 40), y: 130 }; // Workers below
    case "moa":
      if (idx < total - 1) return { x: padding + idx * (nodeWidth + 30), y: 40 }; // Proposers
      return { x: padding + ((total - 2) * (nodeWidth + 30)) / 2, y: 140 }; // Aggregator
    default:
      return { x: padding + idx * (nodeWidth + 60), y: 80 };
  }
}

interface FlowEdge { from: string; to: string; label?: string; type?: string }

function generateEdges(agents: AgentConfig[], mode: string): FlowEdge[] {
  if (agents.length < 2) return [];
  const edges: FlowEdge[] = [];

  switch (mode) {
    case "pipeline":
      for (let i = 0; i < agents.length - 1; i++) {
        edges.push({ from: agents[i]!.id, to: agents[i + 1]!.id, label: "数据" });
      }
      break;
    case "debate":
      if (agents.length >= 2) {
        edges.push({ from: agents[0]!.id, to: agents[1]!.id, type: "debate", label: "辩论" });
        edges.push({ from: agents[1]!.id, to: agents[0]!.id, type: "debate", label: "反驳" });
        if (agents.length >= 3) {
          edges.push({ from: agents[0]!.id, to: agents[2]!.id, label: "观点" });
          edges.push({ from: agents[1]!.id, to: agents[2]!.id, label: "观点" });
        }
      }
      break;
    case "reflect":
      if (agents.length >= 2) {
        edges.push({ from: agents[0]!.id, to: agents[1]!.id, label: "输出" });
        edges.push({ from: agents[1]!.id, to: agents[0]!.id, label: "反馈", type: "debate" });
      }
      break;
    case "hierarchy":
      for (let i = 1; i < agents.length; i++) {
        edges.push({ from: agents[0]!.id, to: agents[i]!.id, label: "任务" });
        edges.push({ from: agents[i]!.id, to: agents[0]!.id, label: "结果", type: "debate" });
      }
      break;
    case "moa":
      const last = agents[agents.length - 1]!;
      for (let i = 0; i < agents.length - 1; i++) {
        edges.push({ from: agents[i]!.id, to: last.id, label: "回答" });
      }
      break;
    case "parallel":
      if (agents.length >= 3) {
        const dispatcher = agents[0]!;
        const merger = agents[agents.length - 1]!;
        const workers = agents.slice(1, -1);
        // Dispatcher → each worker
        for (const w of workers) {
          edges.push({ from: dispatcher.id, to: w.id, label: "子任务" });
        }
        // Each worker → merger
        for (const w of workers) {
          edges.push({ from: w.id, to: merger.id, label: "结果" });
        }
      }
      break;
    default:
      // Auto: show pipeline as default
      for (let i = 0; i < agents.length - 1; i++) {
        edges.push({ from: agents[i]!.id, to: agents[i + 1]!.id });
      }
  }

  return edges;
}


/**
 * Get default role/prompt templates for each mode.
 * These auto-fill when user switches mode, giving them a starting point.
 */
function getModeTemplates(mode: string, agentCount: number): Array<{ role: string; prompt: string }> {
  switch (mode) {
    case "pipeline":
      const pipeTemplates: Array<{ role: string; prompt: string }> = [];
      for (let i = 0; i < agentCount; i++) {
        if (i === 0) {
          pipeTemplates.push({ role: "信息提取", prompt: "你是信息提取专家。\n\n任务：从输入内容中提取关键信息，去除噪音，输出结构化的核心数据。\n\n要求：\n1. 保留所有重要事实和数据\n2. 去除重复和无关内容\n3. 以清晰的条目格式输出\n4. 只输出结果，不要输出思考过程" });
        } else if (i === agentCount - 1) {
          pipeTemplates.push({ role: "输出整合", prompt: "你是专业的内容整合专家。\n\n任务：将上游处理的结果转化为最终交付物。\n\n要求：\n1. 结构清晰，使用标题和分段\n2. 先给结论，再展开细节\n3. 用通俗语言解释专业内容\n4. 只输出最终结果" });
        } else {
          pipeTemplates.push({ role: `处理步骤 ${i}`, prompt: `你是流水线中的第 ${i + 1} 步处理者。\n\n任务：接收上一步的输出，进行进一步处理和加工。\n\n要求：\n1. 基于上游输入进行你的专项处理\n2. 输出要能被下游直接使用\n3. 只输出处理结果，不要输出思考过程` });
        }
      }
      return pipeTemplates;

    case "debate":
      const debateTemplates: Array<{ role: string; prompt: string }> = [];
      if (agentCount >= 1) {
        debateTemplates.push({ role: "正方论证", prompt: "你是辩论正方。\n\n角色定位：坚定支持给定观点的论证者。\n\n行为准则：\n1. 用逻辑推理和具体证据支撑你的立场\n2. 预判反方可能的攻击点，提前准备防御\n3. 承认对方合理的部分，但论证为何你的立场整体更优\n4. 每轮发言结构：核心论点 → 证据支撑 → 回应反方 → 总结强化\n5. 只输出论点，不要输出思考过程\n\n注意：即使内心认为反方有道理，也要尽力为正方找到最强论证角度。" });
      }
      if (agentCount >= 2) {
        debateTemplates.push({ role: "反方质疑", prompt: "你是辩论反方。\n\n角色定位：严格质疑和挑战给定观点的批判者。\n\n行为准则：\n1. 找出正方论证中的逻辑漏洞和隐含假设\n2. 提供反例和替代解释\n3. 质疑证据的可靠性和适用性\n4. 每轮发言结构：指出漏洞 → 提供反证 → 替代方案 → 风险警示\n5. 只输出论点，不要输出思考过程\n\n注意：你的目标不是否定一切，而是确保最终决策经过严格检验。" });
      }
      if (agentCount >= 3) {
        debateTemplates.push({ role: "裁判总结", prompt: "你是公正的裁判和决策者。\n\n角色定位：综合正反双方观点，做出最终判断。\n\n行为准则：\n1. 客观评估双方各自的论证强度\n2. 识别哪些分歧是事实层面的，哪些是价值层面的\n3. 对有争议的点给出你的判断和理由\n4. 输出结构：双方共识 → 核心分歧 → 我的判断 → 最终结论\n5. 只输出裁决结果\n\n注意：不要和稀泥。明确表态你支持哪一方的哪些观点。" });
      }
      // Extra agents become additional debaters
      for (let i = 3; i < agentCount; i++) {
        debateTemplates.push({ role: `辩手 ${String.fromCharCode(64 + i)}`, prompt: `你是辩论中的第 ${i + 1} 位参与者。\n\n要求：\n1. 提出前面辩手都没有提到的新角度\n2. 可以支持正方或反方，但要有独特观点\n3. 只输出你的论点，不要输出思考过程` });
      }
      return debateTemplates;

    case "reflect":
      return [
        { role: "创作者", prompt: "你是高质量内容创作者。\n\n第一轮：根据任务要求，生成你的最佳输出。\n后续轮次：根据审查员的反馈进行修改。\n\n修改原则：\n1. 认真对待每一条反馈，不要敷衍\n2. 如果你不同意某条反馈，解释原因而不是忽略\n3. 修改后在末尾简要说明你改了什么\n4. 追求实质性改进，不要只做表面修饰" },
        { role: "质量审查", prompt: "你是严格但建设性的质量审查员。\n\n评审标准：\n1. 准确性：信息是否正确，有无事实错误\n2. 完整性：是否覆盖了任务的所有要求\n3. 清晰度：表达是否清晰易懂\n4. 实用性：输出是否可以直接使用\n5. 格式：结构是否合理\n\n输出格式：\n- 总分（1-10）\n- 优点（列举做得好的地方）\n- 问题（具体指出哪里有问题）\n- 建议（给出可操作的改进方向）\n\n在回复末尾必须附上：```json\n{\"score\": N}\n```\n\n注意：5分以下才需要重做，7分以上可以通过。给分要有区分度，不要所有东西都给8分。" },
      ].slice(0, agentCount);

    case "hierarchy":
      const hierTemplates: Array<{ role: string; prompt: string }> = [];
      hierTemplates.push({ role: "项目负责人", prompt: "你是项目负责人（Lead Agent）。\n\n职责：\n1. 分析总任务，理解目标和约束\n2. 将任务拆解为独立的子任务\n3. 根据团队成员的专长分配任务\n4. 综合所有成员的输出，生成最终交付物\n\n任务拆解输出格式：\n```json\n[{\"agent\": \"角色名\", \"subtask\": \"具体任务描述\"}]\n```\n\n综合阶段：整合所有结果，确保一致性和完整性，只输出最终结果。" });
      for (let i = 1; i < agentCount; i++) {
        hierTemplates.push({ role: `执行者 ${String.fromCharCode(64 + i)}`, prompt: `你是团队中的执行者 ${String.fromCharCode(64 + i)}。\n\n职责：负责完成项目负责人分配给你的子任务。\n\n工作原则：\n1. 严格按照分配的子任务执行\n2. 输出要有明确的结构\n3. 只输出结果，不要输出思考过程\n4. 如果子任务不清晰，先说明你的理解再执行` });
      }
      return hierTemplates;

    case "moa":
      const moaTemplates: Array<{ role: string; prompt: string }> = [];
      for (let i = 0; i < agentCount; i++) {
        if (i === agentCount - 1) {
          moaTemplates.push({ role: "综合决策", prompt: "你是最终决策者。\n\n你会收到多位专家对同一问题的独立回答。\n\n你的任务：\n1. 阅读所有专家的回答\n2. 识别共识点（多人同意的部分大概率是对的）\n3. 分析分歧点（不同意见各自的道理）\n4. 综合出一个比任何单个回答都更好的最终答案\n5. 只输出最终答案，不要输出分析过程" });
        } else {
          moaTemplates.push({ role: `视角 ${String.fromCharCode(65 + i)}`, prompt: `你是独立思考的专家（视角 ${String.fromCharCode(65 + i)}）。\n\n要求：\n1. 完全独立地回答问题，不要考虑其他人可能怎么回答\n2. 发挥你的专业优势，给出你认为最好的答案\n3. 如果问题有多个合理答案，选择你最有信心的那个\n4. 只输出你的答案，不要输出思考过程` });
        }
      }
      return moaTemplates;

    case "parallel":
      const parallelTemplates = [
        { role: "任务调度", prompt: "你是任务调度者。将总任务拆分为多个独立的子任务，分配给团队成员。\n\n输出格式（JSON 数组）：\n[{\"agent\":\"角色名\",\"subtask\":\"具体子任务描述\"}]\n\n要求：\n1. 子任务之间尽量独立，可以并行执行\n2. 每个子任务描述要清晰具体\n3. 只输出 JSON，不要其他内容" },
      ];
      // Middle agents are all workers
      for (let i = 1; i < agentCount - 1; i++) {
        parallelTemplates.push({ role: `执行者 ${String.fromCharCode(65 + i - 1)}`, prompt: "你负责独立完成分配给你的子任务。\n\n要求：\n1. 专注于你的部分，不需要考虑全局\n2. 输出要完整、可独立使用\n3. 只输出结果，不要输出思考过程\n4. 如果需要其他信息才能完成，明确指出缺什么" });
      }
      // Last agent is merger
      parallelTemplates.push({ role: "结果合并", prompt: "你是结果合并者。你会收到多个团队成员各自完成的子任务结果。\n\n你的职责：\n1. 阅读所有成员的输出\n2. 检查是否有遗漏或矛盾\n3. 将所有结果整合为一个完整、连贯的最终输出\n4. 确保最终输出覆盖了原始任务的所有要求\n5. 只输出最终整合结果" });
      return parallelTemplates.slice(0, agentCount);

    default:
      return [];
  }
}
