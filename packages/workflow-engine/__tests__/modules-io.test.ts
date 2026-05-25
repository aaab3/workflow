/**
 * IO module tests — file-read, file-write, http-request, terminal
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileReadModule } from "../src/modules/io/file-read.js";
import { fileWriteModule } from "../src/modules/io/file-write.js";
import { httpRequestModule } from "../src/modules/io/http-request.js";
import { terminalModule } from "../src/modules/io/terminal.js";
import { createDefaultSecurityConfig } from "../src/security.js";
import type { ExecutionContext } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

let tempDir: string;

function makeContext(basePath?: string): ExecutionContext {
  return {
    workflowId: "test",
    executionId: "test-exec",
    status: "running",
    startTime: Date.now(),
    nodeStates: new Map(),
    variables: {},
    logs: [],
    errors: [],
    metrics: { totalNodes: 0, completedNodes: 0, failedNodes: 0, skippedNodes: 0 },
    security: basePath ? createDefaultSecurityConfig(basePath) : undefined,
  };
}

// ─── File Read Tests ────────────────────────────────────────────────────────

describe("fileReadModule", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wf-test-"));
    await writeFile(join(tempDir, "hello.txt"), "Hello World", "utf-8");
    await writeFile(join(tempDir, "data.json"), '{"key":"value"}', "utf-8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should read a text file", async () => {
    const ctx = makeContext(tempDir);
    const result = await fileReadModule.execute({}, { path: "hello.txt" }, ctx);
    expect(result.content).toBe("Hello World");
    expect(result.size).toBe(11);
  });

  it("should read a JSON file", async () => {
    const ctx = makeContext(tempDir);
    const result = await fileReadModule.execute({}, { path: "data.json" }, ctx);
    expect(result.content).toBe('{"key":"value"}');
  });

  it("should throw on missing file", async () => {
    const ctx = makeContext(tempDir);
    await expect(
      fileReadModule.execute({}, { path: "nonexistent.txt" }, ctx)
    ).rejects.toThrow();
  });

  it("should block path traversal when security is enabled", async () => {
    const ctx = makeContext(tempDir);
    await expect(
      fileReadModule.execute({}, { path: "../../../../etc/passwd" }, ctx)
    ).rejects.toThrow(/traversal|outside/i);
  });

  it("should block .env files when security is enabled", async () => {
    await writeFile(join(tempDir, ".env"), "SECRET=123", "utf-8");
    const ctx = makeContext(tempDir);
    await expect(
      fileReadModule.execute({}, { path: ".env" }, ctx)
    ).rejects.toThrow(/blocked/i);
  });

  it("should work without security config (backward compat)", async () => {
    const ctx = makeContext(); // no security
    const result = await fileReadModule.execute(
      {},
      { path: join(tempDir, "hello.txt") },
      ctx
    );
    expect(result.content).toBe("Hello World");
  });
});

// ─── File Write Tests ───────────────────────────────────────────────────────

describe("fileWriteModule", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wf-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should write a file", async () => {
    const ctx = makeContext(tempDir);
    const result = await fileWriteModule.execute(
      { content: "test content" },
      { path: "output.txt" },
      ctx
    );
    expect(result.success).toBe(true);

    const content = await readFile(join(tempDir, "output.txt"), "utf-8");
    expect(content).toBe("test content");
  });

  it("should create parent directories", async () => {
    const ctx = makeContext(tempDir);
    await fileWriteModule.execute(
      { content: "nested" },
      { path: "sub/dir/file.txt", createDirs: true },
      ctx
    );

    const content = await readFile(join(tempDir, "sub/dir/file.txt"), "utf-8");
    expect(content).toBe("nested");
  });

  it("should append to file", async () => {
    const ctx = makeContext(tempDir);
    await fileWriteModule.execute({ content: "line1\n" }, { path: "log.txt" }, ctx);
    await fileWriteModule.execute({ content: "line2\n" }, { path: "log.txt", append: true }, ctx);

    const content = await readFile(join(tempDir, "log.txt"), "utf-8");
    expect(content).toBe("line1\nline2\n");
  });

  it("should block path traversal when security is enabled", async () => {
    const ctx = makeContext(tempDir);
    await expect(
      fileWriteModule.execute({ content: "hack" }, { path: "../../../tmp/evil.txt" }, ctx)
    ).rejects.toThrow(/traversal|outside/i);
  });
});

// ─── HTTP Request Tests ─────────────────────────────────────────────────────

describe("httpRequestModule", () => {
  it("should throw on missing URL", async () => {
    const ctx = makeContext();
    await expect(
      httpRequestModule.execute({}, { url: "" }, ctx)
    ).rejects.toThrow(); // Zod validation rejects empty/invalid URL
  });

  it("should block private IPs when security is enabled", async () => {
    const ctx = makeContext();
    ctx.security = createDefaultSecurityConfig();
    await expect(
      httpRequestModule.execute({}, { url: "http://127.0.0.1/secret" }, ctx)
    ).rejects.toThrow(/private|blocked/i);
  });

  it("should block metadata endpoint", async () => {
    const ctx = makeContext();
    ctx.security = createDefaultSecurityConfig();
    await expect(
      httpRequestModule.execute({}, { url: "http://169.254.169.254/latest/meta-data" }, ctx)
    ).rejects.toThrow(/private|blocked/i);
  });

  it("should block non-http protocols when security is enabled", async () => {
    const ctx = makeContext();
    ctx.security = createDefaultSecurityConfig();
    await expect(
      httpRequestModule.execute({}, { url: "file:///etc/passwd" }, ctx)
    ).rejects.toThrow(/protocol.*not allowed/i);
  });
});

// ─── Terminal Tests ─────────────────────────────────────────────────────────

describe("terminalModule", () => {
  it("should execute a simple command", async () => {
    const ctx = makeContext();
    const result = await terminalModule.execute(
      {},
      { command: "echo hello" },
      ctx
    );
    expect((result.stdout as string).trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("should throw on missing command", async () => {
    const ctx = makeContext();
    await expect(
      terminalModule.execute({}, { command: "" }, ctx)
    ).rejects.toThrow(/command/i);
  });

  it("should block when terminal is disabled by default", async () => {
    // Default security config has terminal.enabled: false
    const ctx = makeContext();
    ctx.security = createDefaultSecurityConfig();
    await expect(
      terminalModule.execute({}, { command: "echo hello" }, ctx)
    ).rejects.toThrow(/disabled/i);
  });

  it("should block dangerous commands when terminal is explicitly enabled", async () => {
    const ctx = makeContext();
    const config = createDefaultSecurityConfig();
    config.terminal.enabled = true;
    config.terminal.allowShell = true;
    ctx.security = config;
    await expect(
      terminalModule.execute({}, { command: "rm -rf /" }, ctx)
    ).rejects.toThrow(/blocked/i);
  });

  it("should pass stdin to command", async () => {
    const ctx = makeContext();
    // Use a cross-platform approach
    const isWindows = process.platform === "win32";
    const command = isWindows ? "findstr ." : "cat";

    const result = await terminalModule.execute(
      { stdin: "input data" },
      { command, stdinMode: "text" },
      ctx
    );
    expect((result.stdout as string).trim()).toContain("input data");
  });

  it("should respect timeout", async () => {
    const ctx = makeContext();
    const isWindows = process.platform === "win32";
    const command = isWindows ? "ping -n 10 127.0.0.1" : "sleep 10";

    await expect(
      terminalModule.execute({}, { command, timeout: 1000 }, ctx)
    ).rejects.toThrow(/timed out/i);
  }, 10000);

  it("should enforce command whitelist", async () => {
    const ctx = makeContext();
    ctx.security = {
      ...createDefaultSecurityConfig(),
      terminal: {
        enabled: true,
        allowedCommands: ["echo", "node"],
        blockedPatterns: [],
        allowShell: true,
        maxExecutionTime: 30000,
      },
    };

    // Allowed command should work
    const result = await terminalModule.execute({}, { command: "echo ok" }, ctx);
    expect((result.stdout as string).trim()).toBe("ok");

    // Blocked command should fail
    await expect(
      terminalModule.execute({}, { command: "curl http://evil.com" }, ctx)
    ).rejects.toThrow(/not in the allowed list/i);
  });
});
