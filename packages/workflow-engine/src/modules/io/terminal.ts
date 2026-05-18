/**
 * io-terminal module - Execute a terminal command and capture output.
 *
 * This is the universal Agent integration point:
 * - Spawn any CLI process (claude, aider, python agent, custom scripts)
 * - Feed data via stdin
 * - Collect stdout as output
 *
 * Supports two modes:
 * 1. "command" mode: Run a command with args, optionally pipe stdin, wait for exit
 * 2. "agent" mode: Start a process, send input via stdin, read until delimiter
 *
 * Examples:
 *   - claude -p "translate this: {{node-1.content}}"
 *   - aider --message "fix the bug in main.py"
 *   - python my_agent.py (with stdin input)
 *   - echo "hello" | any-cli-tool
 */

import { spawn } from "node:child_process";
import { validateCommand } from "../../security.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

export const terminalModule: ModuleHandler = {
  meta: {
    id: "io-terminal",
    name: "终端/Agent",
    category: "io",
    description: "执行终端命令或调用外部 Agent（通过 stdin/stdout 交互）",
    icon: "terminal",
    inputs: [
      { id: "stdin", name: "输入内容", type: "string" },
    ],
    outputs: [
      { id: "stdout", name: "输出内容", type: "string" },
      { id: "stderr", name: "错误输出", type: "string" },
      { id: "exitCode", name: "退出码", type: "number" },
    ],
    configSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要执行的命令（如 claude -p、python agent.py、aider --message）",
        },
        args: {
          type: "array",
          description: "命令参数列表（JSON 数组格式），也可以直接写在 command 里",
        },
        stdinMode: {
          type: "string",
          enum: ["none", "text", "json"],
          default: "text",
          description: "stdin 输入模式：none=不传入，text=纯文本传入，json=JSON序列化后传入",
        },
        outputMode: {
          type: "string",
          enum: ["text", "json", "lastLine"],
          default: "text",
          description: "输出解析模式：text=原样输出，json=解析为JSON对象，lastLine=只取最后一行",
        },
        timeout: {
          type: "number",
          default: 120000,
          minimum: 1000,
          maximum: 3600000,
          description: "超时时间（毫秒），默认 2 分钟",
        },
        cwd: {
          type: "string",
          description: "工作目录（可选）",
        },
        env: {
          type: "object",
          description: "额外环境变量（可选，JSON 格式）",
        },
        shell: {
          type: "boolean",
          default: true,
          description: "是否通过 shell 执行（开启后支持管道、通配符等 shell 语法）",
        },
      },
      required: ["command"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const command = config.command as string;
    const args = (config.args as string[]) ?? [];
    const stdinMode = (config.stdinMode as string) ?? "text";
    const outputMode = (config.outputMode as string) ?? "text";
    const cwd = config.cwd as string | undefined;
    const extraEnv = (config.env as Record<string, string>) ?? {};

    // Security: use policy from context, with config overrides
    const terminalPolicy = _context.security?.terminal;
    const timeout = (config.timeout as number) ?? terminalPolicy?.maxExecutionTime ?? 120000;
    const useShell = terminalPolicy?.allowShell !== false && config.shell !== false;

    if (!command) {
      throw new Error("Command is required");
    }

    // Security validation
    if (terminalPolicy) {
      const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;
      validateCommand(fullCommand, terminalPolicy);
    }

    // Prepare stdin content
    let stdinContent: string | null = null;
    const stdinInput = inputs.stdin;

    if (stdinMode === "text" && stdinInput !== undefined && stdinInput !== null) {
      stdinContent = String(stdinInput);
    } else if (stdinMode === "json" && stdinInput !== undefined && stdinInput !== null) {
      stdinContent = JSON.stringify(stdinInput);
    }

    // Execute the command
    const result = await executeCommand({
      command,
      args,
      stdinContent,
      timeout,
      cwd,
      env: { ...process.env, ...extraEnv },
      shell: useShell,
    });

    // Parse output based on mode
    let parsedOutput: unknown = result.stdout;

    if (outputMode === "json") {
      try {
        parsedOutput = JSON.parse(result.stdout.trim());
      } catch {
        // If JSON parse fails, return as text
        parsedOutput = result.stdout;
      }
    } else if (outputMode === "lastLine") {
      const lines = result.stdout.trim().split("\n");
      parsedOutput = lines[lines.length - 1] ?? "";
    }

    // If exit code is non-zero and there's stderr, throw
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
  args: string[];
  stdinContent: string | null;
  timeout: number;
  cwd?: string;
  env: Record<string, string | undefined>;
  shell: boolean;
}

function executeCommand(options: CommandOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const { command, args, stdinContent, timeout, cwd, env, shell } = options;

    let spawnCmd: string;
    let spawnArgs: string[];

    if (shell) {
      // When using shell, combine command and args into a single string
      const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;
      spawnCmd = fullCommand;
      spawnArgs = [];
    } else {
      spawnCmd = command;
      spawnArgs = args;
    }

    const child = spawn(spawnCmd, spawnArgs, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      shell,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Timeout handler
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

    // Write stdin if provided
    if (stdinContent !== null) {
      child.stdin.write(stdinContent);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}
