/**
 * io-terminal module - Execute a terminal command and capture output.
 */

import { z } from "zod";
import { spawn } from "node:child_process";
import { validateCommand } from "../../security.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const configZod = z.object({
  command: z
    .string()
    .min(1)
    .describe("要执行的命令（可从本机应用列表一键选择）"),
  stdinMode: z
    .enum(["none", "text", "json"])
    .default("text")
    .describe("stdin：none=不传，text=纯文本，json=JSON"),
  outputMode: z
    .enum(["text", "json", "lastLine"])
    .default("text")
    .describe("输出：text=原文，json=解析 JSON，lastLine=最后一行"),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(120000)
    .describe("超时（毫秒）"),
  cwd: z.string().optional().describe("工作目录（可选）"),
  env: z.record(z.string()).optional().describe("额外环境变量（JSON 对象）"),
  shell: z
    .boolean()
    .default(true)
    .describe("通过 shell 执行（支持管道；需服务端安全策略允许）"),
});

const inputsZod = z.object({
  stdin: z.union([z.string(), z.unknown()]).optional(),
});

export const terminalModule: ModuleHandler = {
  meta: {
    id: "io-terminal",
    name: "终端/Agent",
    category: "io",
    description: "执行本机 CLI 或 Agent（可从检测到的应用一键选择）",
    icon: "terminal",
    inputs: [{ id: "stdin", name: "输入内容", type: "string" }],
    outputs: [
      { id: "stdout", name: "输出内容", type: "string" },
      { id: "stderr", name: "错误输出", type: "string" },
      { id: "exitCode", name: "退出码", type: "number" },
    ],
    configSchema: {},
    version: "2.1.0",
  },

  configZod,
  inputsZod,

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const cfg = configZod.parse(config);
    const ins = inputsZod.parse(inputs);

    const terminalPolicy = _context.security?.terminal;
    const timeout = cfg.timeout ?? terminalPolicy?.maxExecutionTime ?? 120000;
    const useShell = terminalPolicy?.allowShell !== false && cfg.shell !== false;

    if (terminalPolicy) {
      validateCommand(cfg.command, terminalPolicy);
    }

    let stdinContent: string | null = null;
    const stdinInput = ins.stdin;

    if (cfg.stdinMode === "text" && stdinInput !== undefined && stdinInput !== null) {
      stdinContent = String(stdinInput);
    } else if (cfg.stdinMode === "json" && stdinInput !== undefined && stdinInput !== null) {
      stdinContent = JSON.stringify(stdinInput);
    }

    const result = await executeCommand({
      command: cfg.command,
      stdinContent,
      timeout,
      cwd: cfg.cwd,
      env: { ...process.env, ...(cfg.env ?? {}) },
      shell: useShell,
    });

    let parsedOutput: unknown = result.stdout;

    if (cfg.outputMode === "json") {
      try {
        parsedOutput = JSON.parse(result.stdout.trim());
      } catch {
        parsedOutput = result.stdout;
      }
    } else if (cfg.outputMode === "lastLine") {
      const lines = result.stdout.trim().split("\n");
      parsedOutput = lines[lines.length - 1] ?? "";
    }

    if (result.exitCode !== 0 && result.stderr.trim()) {
      throw new Error(
        `Command exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`
      );
    }

    return {
      stdout: parsedOutput,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  },
};

interface CommandOptions {
  command: string;
  stdinContent: string | null;
  timeout: number;
  cwd?: string;
  env: Record<string, string | undefined>;
  shell: boolean;
}

function executeCommand(
  options: CommandOptions
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const { command, stdinContent, timeout, cwd, env, shell } = options;

    const child = spawn(command, [], {
      cwd,
      env: env as NodeJS.ProcessEnv,
      shell,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeout}ms`));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start command: ${err.message}`));
    });

    if (stdinContent !== null) {
      child.stdin.write(stdinContent);
    }
    child.stdin.end();
  });
}

/** Patch derived JSON Schema so UI shows cli-app picker on `command` */
export function patchTerminalConfigSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (props?.command) {
    props.command = { ...props.command, format: "cli-app" };
  }
  return schema;
}
