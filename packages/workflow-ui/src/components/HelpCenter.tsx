/**
 * Help Center - detailed usage manual explaining every node,
 * connection rules, and practical examples.
 * Written to be understandable by a primary school student.
 */

import { useState } from "react";
import guideContent from "./help/guide.md?raw";
import { MarkdownView } from "./help/MarkdownView";

interface HelpCenterProps {
  open: boolean;
  onClose: () => void;
}

type TabId = "overview" | "nodes" | "fullguide" | "connections" | "examples" | "faq";

export function HelpCenter({ open, onClose }: HelpCenterProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  if (!open) return null;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "overview", label: "基本概念" },
    { id: "nodes", label: "节点简介" },
    { id: "fullguide", label: "📖 详细手册" },
    { id: "connections", label: "连线规则" },
    { id: "examples", label: "实战案例" },
    { id: "faq", label: "常见问题" },
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "white", borderRadius: 16, width: 700, height: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.25)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1 }}>📖 使用说明书</h2>
          <button onClick={onClose} style={{ fontSize: 20, border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-muted)" }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", padding: "0 24px" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "10px 16px",
                fontSize: 12,
                fontWeight: activeTab === tab.id ? 600 : 400,
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid var(--color-primary)" : "2px solid transparent",
                background: "transparent",
                color: activeTab === tab.id ? "var(--color-primary)" : "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px", fontSize: 13, lineHeight: 2, color: "var(--color-text)" }}>
          {activeTab === "overview" && <OverviewContent />}
          {activeTab === "nodes" && <NodesContent />}
          {activeTab === "fullguide" && <MarkdownView content={guideContent} />}
          {activeTab === "connections" && <ConnectionsContent />}
          {activeTab === "examples" && <ExamplesContent />}
          {activeTab === "faq" && <FaqContent />}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 15, fontWeight: 700, margin: "20px 0 8px", color: "var(--color-text)" }}>{children}</h3>;
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ margin: "12px 0", padding: "10px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 12, color: "#0369a1", lineHeight: 1.8 }}>
      💡 {children}
    </div>
  );
}

// ─── Tab Contents ───────────────────────────────────────────────────────────

function OverviewContent() {
  return (
    <div>
      <SectionTitle>什么是工作流？</SectionTitle>
      <p>想象一条<b>流水线</b>：原材料从一端进去，经过一道道工序，最后变成成品出来。</p>
      <p>工作流就是这样的流水线，只不过流动的不是实物，而是<b>数据</b>（文字、数字、文件等）。</p>

      <SectionTitle>三个核心概念</SectionTitle>
      <p><b>1. 节点（Node）</b> = 流水线上的一道工序</p>
      <p style={{ paddingLeft: 16 }}>每个节点做一件事：读文件、调用 AI、写代码、判断条件...</p>

      <p><b>2. 连线（Edge）</b> = 传送带</p>
      <p style={{ paddingLeft: 16 }}>连线把一个节点的输出送到下一个节点的输入，就像传送带把半成品送到下一道工序。</p>

      <p><b>3. 端口（Port）</b> = 接口</p>
      <p style={{ paddingLeft: 16 }}>节点左边的圆点是<b>输入端口</b>（接收数据），右边的圆点是<b>输出端口</b>（发送数据）。</p>

      <Tip>
        记住这个比喻：节点 = 工人，连线 = 传送带，端口 = 工人的手。左手接东西（输入），右手递东西（输出）。
      </Tip>

      <SectionTitle>数据类型（端口颜色）</SectionTitle>
      <p>端口的颜色代表它能处理什么类型的数据：</p>
      <ul style={{ paddingLeft: 20 }}>
        <li><span style={{ color: "#22c55e" }}>●</span> <b>绿色 = 文本（string）</b> — 一段文字，比如"你好"、文件内容</li>
        <li><span style={{ color: "#3b82f6" }}>●</span> <b>蓝色 = 数字（number）</b> — 比如 42、3.14</li>
        <li><span style={{ color: "#f59e0b" }}>●</span> <b>黄色 = 布尔（boolean）</b> — 只有"是"或"否"两个值</li>
        <li><span style={{ color: "#a855f7" }}>●</span> <b>紫色 = 对象（object）</b> — 一组数据的集合</li>
        <li><span style={{ color: "#ec4899" }}>●</span> <b>粉色 = 数组（array）</b> — 一列数据</li>
        <li><span style={{ color: "#64748b" }}>●</span> <b>灰色 = 任意（any）</b> — 什么类型都行</li>
      </ul>
    </div>
  );
}

function NodesContent() {
  return (
    <div>
      <SectionTitle>🤖 LLM 对话</SectionTitle>
      <p><b>做什么：</b>把你的问题发给 AI（比如 GPT-4），AI 回答你。</p>
      <p><b>输入：</b>用户消息（你想问 AI 的话）</p>
      <p><b>输出：</b>回复（AI 的回答）、用量（花了多少 token）</p>
      <p><b>配置项：</b></p>
      <ul style={{ paddingLeft: 20 }}>
        <li><b>模型</b> — 选哪个 AI 模型（gpt-4o 最聪明，gpt-4o-mini 最快最便宜）</li>
        <li><b>系统提示词</b> — 告诉 AI 它的角色，比如"你是一个翻译官"</li>
        <li><b>温度</b> — 0=每次回答一样，2=每次回答都不同。一般用 0.7</li>
      </ul>
      <Tip>适合场景：翻译、总结、问答、写作、分析文本</Tip>

      <SectionTitle>🔌 读取文件</SectionTitle>
      <p><b>做什么：</b>读取电脑上的一个文件，把内容取出来。</p>
      <p><b>输入：</b>无（路径在配置里填）</p>
      <p><b>输出：</b>内容（文件里的文字）、大小（文件有多大）</p>
      <p><b>配置项：</b></p>
      <ul style={{ paddingLeft: 20 }}>
        <li><b>路径</b> — 文件在哪里，比如 C:/文档/笔记.txt</li>
        <li><b>编码</b> — 一般选 utf-8（中文和英文都能读）</li>
      </ul>
      <Tip>适合场景：读取本地文件内容，然后传给 AI 处理</Tip>

      <SectionTitle>🔌 写入文件</SectionTitle>
      <p><b>做什么：</b>把数据保存到电脑上的一个文件里。</p>
      <p><b>输入：</b>内容（要写入的文字）</p>
      <p><b>输出：</b>成功（是否写入成功）</p>
      <p><b>配置项：</b></p>
      <ul style={{ paddingLeft: 20 }}>
        <li><b>路径</b> — 保存到哪里</li>
        <li><b>追加模式</b> — 开启后不会覆盖原文件，而是在末尾添加</li>
      </ul>

      <SectionTitle>🔌 HTTP 请求</SectionTitle>
      <p><b>做什么：</b>访问一个网址，获取或发送数据。就像浏览器访问网页一样。</p>
      <p><b>输入：</b>请求体（发送的数据，GET 请求不需要）</p>
      <p><b>输出：</b>响应（网站返回的数据）、状态码（200=成功，404=找不到）</p>
      <p><b>配置项：</b></p>
      <ul style={{ paddingLeft: 20 }}>
        <li><b>URL</b> — 网址，比如 https://api.example.com/data</li>
        <li><b>方法</b> — GET=获取数据，POST=发送数据</li>
      </ul>
      <Tip>适合场景：调用第三方 API、获取网络数据、发送通知</Tip>

      <SectionTitle>⚡ JavaScript 代码</SectionTitle>
      <p><b>做什么：</b>运行你写的代码，可以做任何数据处理。</p>
      <p><b>输入：</b>输入数据（通过 inputs 对象访问）</p>
      <p><b>输出：</b>结果（你 return 的内容）</p>
      <p><b>怎么写：</b></p>
      <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 6, fontSize: 11, overflow: "auto" }}>
{`// inputs.xxx 可以拿到上游传来的数据
const text = inputs.content;
const upper = text.toUpperCase();
return { result: upper };`}
      </pre>
      <Tip>适合场景：数据转换、格式化、计算、任何自定义逻辑</Tip>

      <SectionTitle>🔀 条件分支</SectionTitle>
      <p><b>做什么：</b>根据条件决定走哪条路。就像岔路口：满足条件走左边，不满足走右边。</p>
      <p><b>输入：</b>判断值（要判断的数据）</p>
      <p><b>输出：</b>真（条件成立时输出）、假（条件不成立时输出）</p>
      <p><b>配置项：</b></p>
      <ul style={{ paddingLeft: 20 }}>
        <li><b>运算符</b> — 怎么判断：等于、不等于、大于、包含、为空...</li>
        <li><b>比较值</b> — 和什么比较</li>
      </ul>
      <Tip>适合场景：如果文件存在就读取，否则创建；如果 AI 回答包含"是"就继续</Tip>

      <SectionTitle>🔀 延时等待</SectionTitle>
      <p><b>做什么：</b>暂停一段时间再继续。就像设了个闹钟。</p>
      <p><b>输入：</b>透传（数据原样传过去）</p>
      <p><b>输出：</b>透传（和输入一样的数据）</p>
      <p><b>配置项：</b></p>
      <ul style={{ paddingLeft: 20 }}>
        <li><b>等待时间</b> — 暂停多少毫秒（1000毫秒 = 1秒）</li>
      </ul>
      <Tip>适合场景：调用 API 太频繁被限制时，加个延时避免被封</Tip>
    </div>
  );
}

function ConnectionsContent() {
  return (
    <div>
      <SectionTitle>连线的基本规则</SectionTitle>
      <p>连线 = 数据的传送带。记住三条规则：</p>

      <p><b>规则 1：只能从右边连到左边</b></p>
      <p style={{ paddingLeft: 16 }}>输出端口（右边）→ 输入端口（左边）。不能反过来。</p>
      <p style={{ paddingLeft: 16 }}>就像水只能从高处流到低处，数据只能从"产出方"流向"接收方"。</p>

      <p><b>规则 2：不能形成环</b></p>
      <p style={{ paddingLeft: 16 }}>A → B → C → A 这样的环是不允许的（会死循环）。</p>
      <p style={{ paddingLeft: 16 }}>数据必须有一个明确的起点和终点。</p>

      <p><b>规则 3：灰色端口可以连任何颜色</b></p>
      <p style={{ paddingLeft: 16 }}>灰色（any）= 万能接口，什么类型都能接。</p>

      <SectionTitle>哪些节点可以互连？</SectionTitle>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 8 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            <th style={{ padding: "8px", border: "1px solid var(--color-border)", textAlign: "left" }}>上游节点（输出）</th>
            <th style={{ padding: "8px", border: "1px solid var(--color-border)", textAlign: "left" }}>下游节点（输入）</th>
            <th style={{ padding: "8px", border: "1px solid var(--color-border)", textAlign: "left" }}>能连吗？</th>
            <th style={{ padding: "8px", border: "1px solid var(--color-border)", textAlign: "left" }}>为什么</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={cellStyle}>读取文件 → 内容</td><td style={cellStyle}>LLM → 用户消息</td><td style={cellStyle}>✅ 能</td><td style={cellStyle}>都是文本</td></tr>
          <tr><td style={cellStyle}>读取文件 → 内容</td><td style={cellStyle}>JavaScript → 输入</td><td style={cellStyle}>✅ 能</td><td style={cellStyle}>JS 接受任意类型</td></tr>
          <tr><td style={cellStyle}>LLM → 回复</td><td style={cellStyle}>写入文件 → 内容</td><td style={cellStyle}>✅ 能</td><td style={cellStyle}>都是文本</td></tr>
          <tr><td style={cellStyle}>LLM → 回复</td><td style={cellStyle}>条件分支 → 判断值</td><td style={cellStyle}>✅ 能</td><td style={cellStyle}>条件接受任意类型</td></tr>
          <tr><td style={cellStyle}>LLM → 用量</td><td style={cellStyle}>写入文件 → 内容</td><td style={cellStyle}>⚠️ 可以但需注意</td><td style={cellStyle}>用量是对象，写入文件会变成 JSON 字符串</td></tr>
          <tr><td style={cellStyle}>条件分支 → 真</td><td style={cellStyle}>LLM → 用户消息</td><td style={cellStyle}>✅ 能</td><td style={cellStyle}>条件输出的是原始数据</td></tr>
          <tr><td style={cellStyle}>HTTP → 状态码</td><td style={cellStyle}>LLM → 用户消息</td><td style={cellStyle}>⚠️ 可以但奇怪</td><td style={cellStyle}>数字会变成文字"200"</td></tr>
        </tbody>
      </table>

      <SectionTitle>常见连线模式</SectionTitle>

      <p><b>模式 1：串行处理</b></p>
      <p style={{ paddingLeft: 16 }}>读文件 → AI处理 → 写文件</p>
      <p style={{ paddingLeft: 16, color: "var(--color-text-muted)" }}>像流水线，一步接一步。</p>

      <p><b>模式 2：分支处理</b></p>
      <p style={{ paddingLeft: 16 }}>读文件 → 条件判断 → (真)AI翻译 / (假)AI总结</p>
      <p style={{ paddingLeft: 16, color: "var(--color-text-muted)" }}>根据条件走不同的路。</p>

      <p><b>模式 3：汇聚处理</b></p>
      <p style={{ paddingLeft: 16 }}>读文件A → JavaScript合并 ← 读文件B</p>
      <p style={{ paddingLeft: 16, color: "var(--color-text-muted)" }}>多个来源的数据汇合到一个节点。</p>

      <Tip>
        简单记忆：绿色连绿色（文本对文本），灰色连什么都行。如果不确定能不能连，就试试——系统不会让你连错的。
      </Tip>
    </div>
  );
}

function ExamplesContent() {
  return (
    <div>
      <SectionTitle>案例 1：AI 翻译文件</SectionTitle>
      <p><b>目标：</b>读取一个英文文件，让 AI 翻译成中文，保存结果。</p>
      <p><b>步骤：</b></p>
      <ol style={{ paddingLeft: 20 }}>
        <li>拖入「读取文件」节点，路径填你的英文文件</li>
        <li>拖入「LLM 对话」节点，系统提示词填"你是翻译官，把以下内容翻译成中文"</li>
        <li>从「读取文件」的"内容"端口 → 连到「LLM」的"用户消息"端口</li>
        <li>拖入「写入文件」节点，路径填输出位置</li>
        <li>从「LLM」的"回复"端口 → 连到「写入文件」的"内容"端口</li>
        <li>保存 → 运行</li>
      </ol>

      <SectionTitle>案例 2：批量处理数据</SectionTitle>
      <p><b>目标：</b>读取一个文件，用代码把每行转成大写，保存。</p>
      <ol style={{ paddingLeft: 20 }}>
        <li>拖入「读取文件」</li>
        <li>拖入「JavaScript」，代码写：</li>
      </ol>
      <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 6, fontSize: 11, margin: "8px 0 8px 20px" }}>
{`const lines = inputs.content.split('\\n');
const upper = lines.map(l => l.toUpperCase());
return { content: upper.join('\\n') };`}
      </pre>
      <ol start={3} style={{ paddingLeft: 20 }}>
        <li>连线：读取文件.内容 → JavaScript.输入</li>
        <li>拖入「写入文件」，连线：JavaScript.结果 → 写入文件.内容</li>
        <li>保存 → 运行</li>
      </ol>

      <SectionTitle>案例 3：条件判断</SectionTitle>
      <p><b>目标：</b>读取文件，如果内容包含"error"就发通知，否则正常处理。</p>
      <ol style={{ paddingLeft: 20 }}>
        <li>拖入「读取文件」</li>
        <li>拖入「条件分支」，运算符选"contains"，比较值填"error"</li>
        <li>连线：读取文件.内容 → 条件分支.判断值</li>
        <li>条件分支的"真"端口 → 连到一个处理错误的节点</li>
        <li>条件分支的"假"端口 → 连到正常处理的节点</li>
      </ol>
      <Tip>条件分支就像岔路口的交警：满足条件的数据走"真"出口，不满足的走"假"出口。</Tip>

      <SectionTitle>案例 4：最简单的 Hello World</SectionTitle>
      <p><b>目标：</b>第一次使用，验证系统能跑。</p>
      <ol style={{ paddingLeft: 20 }}>
        <li>拖入一个「JavaScript」节点</li>
        <li>点击它，在右侧代码框写：<code>return {"{"} message: "Hello World!" {"}"}</code></li>
        <li>点「保存」→ 点「▶ 运行」</li>
        <li>底部会弹出结果面板，显示 {`{"message": "Hello World!"}`}</li>
      </ol>
    </div>
  );
}

function FaqContent() {
  return (
    <div>
      <SectionTitle>Q: 为什么运行后没有反应？</SectionTitle>
      <p>A: 需要先点「保存」再点「运行」。如果还是没反应，检查后端服务是否启动（终端运行 pnpm --filter @openclaw/workflow-server dev）。</p>

      <SectionTitle>Q: 连线连不上怎么办？</SectionTitle>
      <p>A: 确保你是从右边的输出端口（圆点）拖到左边的输入端口。不能从左拖到右，也不能从输出拖到输出。</p>

      <SectionTitle>Q: 节点配置里的 {`{{xxx}}`} 是什么意思？</SectionTitle>
      <p>A: 这是表达式语法，用来引用其他节点的输出。比如 {`{{node-1.content}}`} 表示"拿 node-1 这个节点输出的 content 数据"。</p>
      <p>一般情况下你不需要手写这个——直接用连线就行，系统会自动传数据。</p>

      <SectionTitle>Q: LLM 节点报错"连接失败"？</SectionTitle>
      <p>A: 检查 baseUrl 和 API Key 是否正确。常见配置：OpenAI 用 https://api.openai.com/v1，本地 Ollama 用 http://localhost:11434/v1，LM Studio 用 http://localhost:1234/v1。API Key 也可以通过环境变量 OPENAI_API_KEY 设置。</p>

      <SectionTitle>Q: 怎么删除连线？</SectionTitle>
      <p>A: 点击连线（线会变亮），然后按 Delete 或 Backspace 键。</p>

      <SectionTitle>Q: 误删了节点怎么办？</SectionTitle>
      <p>A: 按 Ctrl+Z 撤销，或点工具栏的 ↩ 按钮。</p>

      <SectionTitle>Q: 一个输出可以连到多个输入吗？</SectionTitle>
      <p>A: 可以！一个输出端口可以同时连到多个节点的输入。数据会被复制一份发给每个下游节点。</p>

      <SectionTitle>Q: 一个输入可以接收多条连线吗？</SectionTitle>
      <p>A: 目前只会使用最后一条连线的数据。建议一个输入端口只连一条线。</p>
    </div>
  );
}

const cellStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid var(--color-border)" };
