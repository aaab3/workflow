/**
 * Interactive onboarding guide - step-by-step tutorial for new users.
 */

import { useState } from "react";

interface OnboardingGuideProps {
  open: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  content: string;
  image?: string;
  tip?: string;
}

const STEPS: Step[] = [
  {
    title: "👋 欢迎使用 OpenClaw Workflow",
    content: "这是一个可视化工作流编辑器。你可以通过拖拽模块、连线、配置参数来创建自动化工作流。\n\n接下来用 3 分钟带你了解基本操作。",
    tip: "工作流 = 一系列自动执行的步骤，像流水线一样把数据从一个节点传到下一个。",
  },
  {
    title: "① 拖入节点",
    content: "左侧面板是模块库，按类别分组：\n\n• 🤖 LLM 模型 — 调用 AI 对话\n• 🔌 输入/输出 — 读写文件、HTTP 请求\n• ⚡ 自定义代码 — 写 JavaScript\n• 🔀 流程控制 — 条件分支、延时\n\n操作：用鼠标把左侧的模块拖到中间画布上，就会创建一个节点。",
    tip: "试试拖一个「读取文件」和一个「JavaScript」到画布上。",
  },
  {
    title: "② 连接节点",
    content: "每个节点左侧有输入端口（圆点），右侧有输出端口（圆点）。\n\n操作：从一个节点右侧的输出端口，按住鼠标拖到另一个节点左侧的输入端口，松开即可连线。\n\n连线表示数据流向：上一个节点的输出会传给下一个节点作为输入。",
    tip: "端口颜色代表数据类型：绿色=文本，蓝色=数字，紫色=对象。相同颜色的端口可以互连。",
  },
  {
    title: "③ 配置节点",
    content: "点击画布上的任意节点，右侧会出现配置面板。\n\n不同类型的节点有不同的配置项：\n• LLM 节点 → 选择模型、填写提示词、调温度\n• 文件节点 → 填写文件路径\n• 代码节点 → 写 JavaScript 代码\n\n配置项会自动生成对应的表单控件（下拉框、滑块等）。",
    tip: "在配置中可以用 {{节点ID.端口名}} 引用其他节点的输出，比如 {{node-1.content}}",
  },
  {
    title: "④ 保存和运行",
    content: "工具栏操作：\n\n• 📂 工作流 — 打开工作流列表，加载或新建\n• 保存 — 保存当前工作流（快捷键 Ctrl+S）\n• ▶ 运行 — 执行工作流\n\n执行后底部会弹出结果面板，显示每个节点的输出数据。",
    tip: "第一次使用需要先点「保存」，然后才能「运行」。",
  },
  {
    title: "⑤ 其他操作",
    content: "• 撤销/重做 — 工具栏 ↩/↪ 按钮，或 Ctrl+Z / Ctrl+Y\n• 删除节点 — 选中节点后按 Delete 键，或在右侧面板点「删除节点」\n• 缩放画布 — 鼠标滚轮，或用右下角的 +/- 按钮\n• 移动画布 — 按住空白区域拖动\n• 小地图 — 右下角的缩略图可以快速导航",
    tip: "按住 Shift 框选多个节点可以批量移动。",
  },
  {
    title: "🎉 准备好了！",
    content: "现在你可以开始创建自己的工作流了。\n\n推荐第一个工作流：\n1. 拖入「JavaScript」节点\n2. 点击它，在右侧代码框写：return { message: 'Hello!' }\n3. 保存 → 运行 → 查看结果\n\n有问题随时可以在工具栏找到帮助。",
    tip: "这个引导可以在设置中重新打开。",
  },
];

export function OnboardingGuide({ open, onClose }: OnboardingGuideProps) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          width: 480,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: "#e2e8f0" }}>
          <div
            style={{
              height: "100%",
              width: `${((step + 1) / STEPS.length) * 100}%`,
              background: "var(--color-primary)",
              transition: "width 0.3s ease",
            }}
          />
        </div>

        {/* Content */}
        <div style={{ padding: "28px 32px", flex: 1, overflowY: "auto" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px", color: "var(--color-text)" }}>
            {current.title}
          </h2>

          <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text)", whiteSpace: "pre-line" }}>
            {current.content}
          </div>

          {current.tip && (
            <div
              style={{
                marginTop: 16,
                padding: "10px 14px",
                background: "#f0f9ff",
                border: "1px solid #bae6fd",
                borderRadius: 8,
                fontSize: 12,
                color: "#0369a1",
                lineHeight: 1.6,
              }}
            >
              💡 {current.tip}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 32px",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Step indicator */}
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            {step + 1} / {STEPS.length}
          </span>

          <div style={{ flex: 1 }} />

          {/* Skip button */}
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              border: "none",
              background: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            跳过
          </button>

          {/* Back button */}
          {!isFirst && (
            <button
              onClick={() => setStep(step - 1)}
              style={{
                padding: "8px 16px",
                fontSize: 12,
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                background: "white",
                cursor: "pointer",
              }}
            >
              上一步
            </button>
          )}

          {/* Next / Done button */}
          <button
            onClick={() => {
              if (isLast) {
                onClose();
              } else {
                setStep(step + 1);
              }
            }}
            style={{
              padding: "8px 20px",
              fontSize: 12,
              border: "none",
              borderRadius: 6,
              background: "var(--color-primary)",
              color: "white",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {isLast ? "开始使用" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}
