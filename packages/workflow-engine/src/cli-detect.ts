/**
 * Detect CLI tools and agents available on the local machine PATH.
 * Used by the workflow UI for click-to-select terminal commands.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CliAppCategory = "agent" | "runtime" | "tool" | "package-manager";

export interface CliAppPreset {
  id: string;
  name: string;
  description: string;
  category: CliAppCategory;
  /** Binary names to search on PATH */
  binaries: string[];
  /** Default command template when selected */
  command: string;
  /** Suggested stdin mode for agent-style CLIs */
  stdinMode?: "none" | "text" | "json";
  icon?: string;
}

/** Known connectable apps — extend as new CLIs become common */
export const CLI_APP_PRESETS: CliAppPreset[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic Claude CLI（-p 打印模式）",
    category: "agent",
    binaries: ["claude"],
    command: "claude -p",
    stdinMode: "text",
    icon: "🟣",
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI Codex 命令行",
    category: "agent",
    binaries: ["codex"],
    command: "codex",
    stdinMode: "text",
    icon: "🟢",
  },
  {
    id: "aider",
    name: "Aider",
    description: "AI 结对编程助手",
    category: "agent",
    binaries: ["aider"],
    command: "aider --message",
    stdinMode: "text",
    icon: "🔵",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google Gemini 命令行",
    category: "agent",
    binaries: ["gemini"],
    command: "gemini",
    stdinMode: "text",
    icon: "✨",
  },
  {
    id: "cursor-agent",
    name: "Cursor Agent",
    description: "Cursor 命令行 Agent",
    category: "agent",
    binaries: ["cursor-agent", "cursor"],
    command: "cursor-agent",
    stdinMode: "text",
    icon: "⬛",
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "本地大模型运行与推理",
    category: "agent",
    binaries: ["ollama"],
    command: "ollama run",
    stdinMode: "text",
    icon: "🦙",
  },
  {
    id: "node",
    name: "Node.js",
    description: "运行 JavaScript 脚本",
    category: "runtime",
    binaries: ["node"],
    command: "node",
    stdinMode: "none",
    icon: "🟩",
  },
  {
    id: "python",
    name: "Python",
    description: "运行 Python 脚本",
    category: "runtime",
    binaries: ["python", "python3", "py"],
    command: process.platform === "win32" ? "py" : "python3",
    stdinMode: "none",
    icon: "🐍",
  },
  {
    id: "npx",
    name: "npx",
    description: "临时运行 npm 包",
    category: "package-manager",
    binaries: ["npx"],
    command: "npx",
    stdinMode: "none",
    icon: "📦",
  },
  {
    id: "pnpm",
    name: "pnpm",
    description: "pnpm 执行脚本",
    category: "package-manager",
    binaries: ["pnpm"],
    command: "pnpm",
    stdinMode: "none",
    icon: "📦",
  },
  {
    id: "gh",
    name: "GitHub CLI",
    description: "GitHub 命令行工具",
    category: "tool",
    binaries: ["gh"],
    command: "gh",
    stdinMode: "none",
    icon: "🐙",
  },
  {
    id: "git",
    name: "Git",
    description: "版本控制",
    category: "tool",
    binaries: ["git"],
    command: "git",
    stdinMode: "none",
    icon: "📁",
  },
  {
    id: "powershell",
    name: "PowerShell",
    description: "Windows PowerShell",
    category: "runtime",
    binaries: ["pwsh", "powershell"],
    command: process.platform === "win32" ? "powershell" : "pwsh",
    stdinMode: "text",
    icon: "💠",
  },
  {
    id: "cmd",
    name: "CMD",
    description: "Windows 命令提示符",
    category: "runtime",
    binaries: ["cmd"],
    command: "cmd /c",
    stdinMode: "text",
    icon: "⬛",
  },
];

export interface DetectedCliApp extends CliAppPreset {
  detected: boolean;
  path?: string;
  resolvedBinary?: string;
}

async function resolveBinary(name: string): Promise<string | null> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", [name], {
        timeout: 5000,
        windowsHide: true,
      });
      const line = stdout.trim().split(/\r?\n/).find((l) => l.trim().length > 0);
      return line?.trim() ?? null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync("which", [name], { timeout: 5000 });
    const line = stdout.trim().split(/\r?\n/)[0];
    return line?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Scan PATH for known CLI presets. Returns all presets; `detected` marks availability.
 */
export async function detectCliApps(): Promise<DetectedCliApp[]> {
  const results: DetectedCliApp[] = [];

  for (const preset of CLI_APP_PRESETS) {
    let path: string | undefined;
    let resolvedBinary: string | undefined;

    for (const binary of preset.binaries) {
      const found = await resolveBinary(binary);
      if (found) {
        path = found;
        resolvedBinary = binary;
        break;
      }
    }

    results.push({
      ...preset,
      detected: Boolean(path),
      path,
      resolvedBinary,
    });
  }

  // Detected apps first, then by category
  const order: Record<CliAppCategory, number> = {
    agent: 0,
    runtime: 1,
    "package-manager": 2,
    tool: 3,
  };

  return results.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    return order[a.category] - order[b.category];
  });
}
