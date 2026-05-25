const CATEGORY_ICONS: Record<string, { emoji: string; bg: string }> = {
  llm: { emoji: "🤖", bg: "#fef3c7" },
  io: { emoji: "🔌", bg: "#dbeafe" },
  code: { emoji: "⚡", bg: "#e0e7ff" },
  flow: { emoji: "🔀", bg: "#dcfce7" },
  data: { emoji: "📊", bg: "#f3e8ff" },
  tool: { emoji: "🔧", bg: "#f1f5f9" },
};

const MODULE_ICONS: Record<string, string> = {
  "llm-chat": "💬",
  "llm-structured": "📋",
  "llm-vision": "👁",
  crew: "👥",
  "io-file-read": "📄",
  "io-file-write": "💾",
  "io-http-request": "🌐",
  "io-text-input": "✏️",
  "io-terminal": "⌨",
  "io-database": "🗄",
  "io-browser": "🌍",
  "code-javascript": "📜",
  "flow-condition": "⑂",
  "flow-delay": "⏱",
  "flow-loop": "🔁",
  "data-transform": "🔄",
  "data-vector": "🧮",
  "tool-cache": "📦",
  "tool-scheduler": "📅",
};

export function getModuleIcon(moduleId: string, category: string): { emoji: string; bg: string } {
  const cat = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.tool;
  return {
    emoji: MODULE_ICONS[moduleId] ?? cat.emoji,
    bg: cat.bg,
  };
}
