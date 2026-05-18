/**
 * Security configuration center.
 *
 * Centralizes all security policies for the workflow engine.
 * Modules access these settings via ExecutionContext.
 */

import { resolve, normalize, isAbsolute, sep } from "node:path";
import { lookup } from "node:dns/promises";

// ─── Security Config ────────────────────────────────────────────────────────

export interface SecurityConfig {
  /** File system access restrictions */
  filesystem: FilesystemPolicy;
  /** Network access restrictions */
  network: NetworkPolicy;
  /** Code execution restrictions */
  code: CodePolicy;
  /** Terminal/command execution restrictions */
  terminal: TerminalPolicy;
}

export interface FilesystemPolicy {
  /** Base directory for file operations (all paths must be within this) */
  basePath: string;
  /** Maximum file size in bytes (default: 10MB) */
  maxFileSize: number;
  /** Blocked path patterns (glob-like) */
  blockedPatterns: string[];
  /** Whether to allow absolute paths (default: false) */
  allowAbsolutePaths: boolean;
}

export interface NetworkPolicy {
  /** Whether to block requests to private/internal IPs */
  blockPrivateIPs: boolean;
  /** Allowed URL patterns (if set, only these are allowed) */
  allowedDomains?: string[];
  /** Blocked URL patterns */
  blockedDomains: string[];
  /** Maximum response size in bytes (default: 50MB) */
  maxResponseSize: number;
  /** Allowed protocols */
  allowedProtocols: string[];
}

export interface CodePolicy {
  /** Maximum execution time in ms */
  maxExecutionTime: number;
  /** Maximum memory in MB for isolated execution */
  maxMemoryMB: number;
  /** Whether to allow network access from code */
  allowNetwork: boolean;
  /** Whether to allow file system access from code */
  allowFileSystem: boolean;
}

export interface TerminalPolicy {
  /** Whether terminal execution is enabled at all */
  enabled: boolean;
  /** Allowed commands (whitelist mode, if set only these are allowed) */
  allowedCommands?: string[];
  /** Blocked command patterns */
  blockedPatterns: string[];
  /** Whether to allow shell mode */
  allowShell: boolean;
  /** Maximum execution time in ms */
  maxExecutionTime: number;
}

// ─── Default Config ─────────────────────────────────────────────────────────

export function createDefaultSecurityConfig(basePath?: string): SecurityConfig {
  return {
    filesystem: {
      basePath: basePath ?? process.cwd(),
      maxFileSize: 10 * 1024 * 1024, // 10MB
      blockedPatterns: [
        "**/.env*",
        "**/.ssh/**",
        "**/id_rsa*",
        "**/id_ed25519*",
        "/etc/shadow",
        "/etc/passwd",
        "**/credentials*",
        "**/*.pem",
        "**/*.key",
      ],
      allowAbsolutePaths: false,
    },
    network: {
      blockPrivateIPs: true,
      blockedDomains: [],
      maxResponseSize: 50 * 1024 * 1024, // 50MB
      allowedProtocols: ["http:", "https:"],
    },
    code: {
      maxExecutionTime: 30000,
      maxMemoryMB: 128,
      allowNetwork: false,
      allowFileSystem: false,
    },
    terminal: {
      // Default: terminal disabled. Users must explicitly opt in for shell access.
      enabled: false,
      blockedPatterns: [
        "rm -rf /",
        "rm -rf /*",
        "mkfs",
        "dd if=",
        ":(){:|:&};:",
        "chmod -R 777 /",
        "curl.*169\\.254",
        "wget.*169\\.254",
      ],
      // Default: shell mode disabled (no pipe/redirect/wildcard expansion).
      // Users must explicitly enable shell mode and ideally set allowedCommands.
      allowShell: false,
      maxExecutionTime: 120000,
    },
  };
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validate and resolve a file path against the security policy.
 * Returns the resolved absolute path if valid, throws if not.
 */
export function validateFilePath(
  filePath: string,
  policy: FilesystemPolicy
): string {
  // Resolve to absolute path
  const resolved = isAbsolute(filePath)
    ? normalize(filePath)
    : resolve(policy.basePath, filePath);

  // Check if within basePath (normalize both for consistent comparison)
  const normalizedBase = normalize(resolve(policy.basePath));
  const normalizedResolved = normalize(resolved);

  if (!normalizedResolved.startsWith(normalizedBase + sep) && normalizedResolved !== normalizedBase) {
    throw new SecurityError(
      `Path traversal blocked: "${filePath}" resolves outside base directory`
    );
  }

  // Check blocked patterns
  for (const pattern of policy.blockedPatterns) {
    if (matchGlobPattern(normalizedResolved, pattern) || matchGlobPattern(filePath, pattern)) {
      throw new SecurityError(
        `Access to "${filePath}" is blocked by security policy`
      );
    }
  }

  // Check absolute path policy
  if (!policy.allowAbsolutePaths && isAbsolute(filePath)) {
    throw new SecurityError(
      `Absolute paths are not allowed. Use relative paths from: ${policy.basePath}`
    );
  }

  return normalizedResolved;
}

/**
 * Validate a URL against the network security policy.
 */
export async function validateUrl(
  url: string,
  policy: NetworkPolicy
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SecurityError(`Invalid URL: ${url}`);
  }

  // Check protocol
  if (!policy.allowedProtocols.includes(parsed.protocol)) {
    throw new SecurityError(
      `Protocol "${parsed.protocol}" is not allowed. Allowed: ${policy.allowedProtocols.join(", ")}`
    );
  }

  // Check allowed domains (whitelist)
  if (policy.allowedDomains && policy.allowedDomains.length > 0) {
    const allowed = policy.allowedDomains.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
    if (!allowed) {
      throw new SecurityError(
        `Domain "${parsed.hostname}" is not in the allowed list`
      );
    }
  }

  // Check blocked domains
  for (const blocked of policy.blockedDomains) {
    if (parsed.hostname === blocked || parsed.hostname.endsWith(`.${blocked}`)) {
      throw new SecurityError(`Domain "${parsed.hostname}" is blocked`);
    }
  }

  // Check private IPs
  if (policy.blockPrivateIPs) {
    await validateNotPrivateIP(parsed.hostname);
  }
}

/**
 * Validate a terminal command against the security policy.
 */
export function validateCommand(
  command: string,
  policy: TerminalPolicy
): void {
  if (!policy.enabled) {
    throw new SecurityError("Terminal execution is disabled");
  }

  // Check whitelist
  if (policy.allowedCommands && policy.allowedCommands.length > 0) {
    const baseCommand = command.split(/\s+/)[0]!;
    if (!policy.allowedCommands.includes(baseCommand)) {
      throw new SecurityError(
        `Command "${baseCommand}" is not in the allowed list. Allowed: ${policy.allowedCommands.join(", ")}`
      );
    }
  }

  // Check blocked patterns
  for (const pattern of policy.blockedPatterns) {
    if (command.includes(pattern) || new RegExp(pattern, "i").test(command)) {
      throw new SecurityError(
        `Command blocked by security policy: matches pattern "${pattern}"`
      );
    }
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

const PRIVATE_IP_RANGES = [
  /^127\./,                          // Loopback
  /^10\./,                           // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./,     // Class B private
  /^192\.168\./,                     // Class C private
  /^169\.254\./,                     // Link-local
  /^0\./,                            // Current network
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
  /^::1$/,                           // IPv6 loopback
];

async function validateNotPrivateIP(hostname: string): Promise<void> {
  // Check if hostname is already an IP
  if (isPrivateIP(hostname)) {
    throw new SecurityError(
      `Requests to private/internal IP addresses are blocked: ${hostname}`
    );
  }

  // Resolve hostname to IP and check
  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      throw new SecurityError(
        `Domain "${hostname}" resolves to private IP ${address}, which is blocked`
      );
    }
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    // DNS resolution failure — allow (might be a valid external host with temporary DNS issues)
  }
}

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

/**
 * Simple glob pattern matching (supports * and **).
 */
function matchGlobPattern(path: string, pattern: string): boolean {
  // Normalize separators
  const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
  const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();

  // Convert glob to regex
  const regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars (except * and ?)
    .replace(/\*\*/g, "{{GLOBSTAR}}")       // Placeholder for **
    .replace(/\*/g, "[^/]*")                // * matches anything except /
    .replace(/\?/g, "[^/]")                 // ? matches single char
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");    // ** matches anything including /

  return new RegExp(`^${regexStr}$`).test(normalizedPath) ||
         new RegExp(regexStr).test(normalizedPath);
}

// ─── Error Type ─────────────────────────────────────────────────────────────

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}
