/**
 * Security module tests
 */

import { describe, it, expect } from "vitest";
import {
  validateFilePath,
  validateCommand,
  createDefaultSecurityConfig,
  SecurityError,
} from "../src/security.js";

describe("validateFilePath", () => {
  const policy = createDefaultSecurityConfig(process.cwd()).filesystem;

  it("should allow paths within basePath", () => {
    const result = validateFilePath("src/index.ts", policy);
    expect(result).toContain("src");
    expect(result).toContain("index.ts");
  });

  it("should block path traversal", () => {
    // Go far enough up to escape basePath
    expect(() => validateFilePath("../../../../../../../../etc/passwd", policy)).toThrow(SecurityError);
  });

  it("should block sensitive file patterns", () => {
    expect(() => validateFilePath(".env", policy)).toThrow(SecurityError);
    expect(() => validateFilePath("config/.env.local", policy)).toThrow(SecurityError);
    expect(() => validateFilePath(".ssh/id_rsa", policy)).toThrow(SecurityError);
  });

  it("should block absolute paths when not allowed", () => {
    expect(() => validateFilePath("/etc/passwd", policy)).toThrow(SecurityError);
  });

  it("should allow normal relative paths", () => {
    expect(() => validateFilePath("data/output.json", policy)).not.toThrow();
    expect(() => validateFilePath("src/utils/helper.ts", policy)).not.toThrow();
  });
});

describe("validateCommand", () => {
  // Tests run against an explicitly enabled policy (default is now disabled)
  function enabledPolicy() {
    const policy = createDefaultSecurityConfig().terminal;
    return { ...policy, enabled: true, allowShell: true };
  }

  it("should block dangerous commands", () => {
    const policy = enabledPolicy();
    expect(() => validateCommand("rm -rf /", policy)).toThrow(SecurityError);
    expect(() => validateCommand("rm -rf /*", policy)).toThrow(SecurityError);
  });

  it("should block metadata endpoint access", () => {
    const policy = enabledPolicy();
    expect(() => validateCommand("curl http://169.254.169.254/latest/meta-data", policy)).toThrow(SecurityError);
  });

  it("should allow normal commands when enabled", () => {
    const policy = enabledPolicy();
    expect(() => validateCommand("echo hello", policy)).not.toThrow();
    expect(() => validateCommand("node script.js", policy)).not.toThrow();
    expect(() => validateCommand("python main.py", policy)).not.toThrow();
  });

  it("should enforce whitelist when set", () => {
    const policy = enabledPolicy();
    const restrictedPolicy = { ...policy, allowedCommands: ["node", "python"] };
    expect(() => validateCommand("node app.js", restrictedPolicy)).not.toThrow();
    expect(() => validateCommand("python main.py", restrictedPolicy)).not.toThrow();
    expect(() => validateCommand("bash script.sh", restrictedPolicy)).toThrow(SecurityError);
  });

  it("should block by default (terminal disabled)", () => {
    // Default config has terminal.enabled: false
    const defaultPolicy = createDefaultSecurityConfig().terminal;
    expect(defaultPolicy.enabled).toBe(false);
    expect(() => validateCommand("echo hello", defaultPolicy)).toThrow(SecurityError);
  });

  it("should block when terminal is explicitly disabled", () => {
    const policy = enabledPolicy();
    const disabledPolicy = { ...policy, enabled: false };
    expect(() => validateCommand("echo hello", disabledPolicy)).toThrow(SecurityError);
  });
});
