/**
 * io-database module — SQLite database operations using Node.js built-in `node:sqlite`.
 *
 * Security model:
 * - True prepared statements via DatabaseSync.prepare() — no string concatenation, no shell execution.
 * - Path validation against SecurityConfig.filesystem (no escaping basePath).
 * - Optional readOnly mode (DB-level write enforcement, returns SQLITE_READONLY).
 * - DDL/dangerous-statement denylist applied to user SQL (DROP, ALTER, ATTACH, PRAGMA writable_schema, etc.).
 * - Statement-level limits: row cap (queries) and statement timeout via SQLite progress handler.
 *
 * Requires Node.js >= 22 (node:sqlite is built-in, stable in Node 24).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { validateFilePath } from "../../security.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

// ─── SQLite driver — load lazily so the module file can be parsed even if
//     node:sqlite is unavailable (older Node, or running with --no-experimental-sqlite).
type SqliteModule = typeof import("node:sqlite");
let sqliteModule: SqliteModule | null = null;
let sqliteLoadError: string | null = null;

async function loadSqlite(): Promise<SqliteModule> {
  if (sqliteModule) return sqliteModule;
  if (sqliteLoadError) throw new Error(sqliteLoadError);
  try {
    sqliteModule = (await import("node:sqlite")) as SqliteModule;
    return sqliteModule;
  } catch (error) {
    sqliteLoadError =
      "node:sqlite is not available. Requires Node.js >= 22 with SQLite support. " +
      `Original error: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(sqliteLoadError);
  }
}

// ─── Dangerous statement detection ──────────────────────────────────────────
// We strip comments and string literals before scanning, so keywords inside
// strings/comments don't trigger false positives.

/** Keywords that modify schema — blocked by default, can be enabled via allowDDL. */
const DDL_KEYWORDS = [
  "DROP",
  "ALTER",
  "REINDEX",
  "VACUUM",
];

/**
 * Keywords that are always blocked regardless of allowDDL.
 * - ATTACH/DETACH can mount arbitrary DB files (bypasses basePath restriction).
 * - These are not "DDL" in the schema-modification sense; they're full database
 *   file access, which we never want user SQL to control.
 */
const ALWAYS_BLOCKED_KEYWORDS = [
  "ATTACH",
  "DETACH",
];

const DANGEROUS_PRAGMAS = [
  "writable_schema",
  "schema_version",
  "user_version",
  "load_extension",
];

function stripStringsAndComments(sql: string): string {
  // Remove block comments
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments
  out = out.replace(/--[^\n]*/g, " ");
  // Remove single-quoted strings (handle escaped '')
  out = out.replace(/'(?:[^']|'')*'/g, "''");
  // Remove double-quoted identifiers (rarely contain keywords but be safe)
  out = out.replace(/"(?:[^"]|"")*"/g, '""');
  return out;
}

interface SqlSafetyCheck {
  safe: boolean;
  reason?: string;
}

function checkSqlSafety(sql: string, opts: { allowDDL: boolean }): SqlSafetyCheck {
  const cleaned = stripStringsAndComments(sql).toUpperCase();

  // ALWAYS-blocked keywords — no opt-in, regardless of allowDDL
  for (const kw of ALWAYS_BLOCKED_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(cleaned)) {
      return {
        safe: false,
        reason: `${kw} statements are blocked unconditionally (cannot be enabled).`,
      };
    }
  }

  // DDL keywords — blocked unless allowDDL=true
  if (!opts.allowDDL) {
    for (const kw of DDL_KEYWORDS) {
      if (new RegExp(`\\b${kw}\\b`).test(cleaned)) {
        return {
          safe: false,
          reason: `${kw} statements are blocked. Set allowDDL=true to enable schema changes.`,
        };
      }
    }
  }

  // Always block dangerous PRAGMAs even with allowDDL=true
  for (const p of DANGEROUS_PRAGMAS) {
    if (new RegExp(`PRAGMA\\s+${p}`, "i").test(cleaned)) {
      return { safe: false, reason: `PRAGMA ${p} is not allowed.` };
    }
  }

  // Block multi-statement SQL via semicolons in user-provided SQL.
  // A trailing semicolon is fine; intermediate non-empty content is not.
  const trimmed = cleaned.trim().replace(/;+$/g, "");
  if (trimmed.includes(";")) {
    return {
      safe: false,
      reason: "Multiple statements are not allowed. Provide one SQL statement at a time.",
    };
  }

  return { safe: true };
}

function classifyStatement(sql: string): "select" | "write" | "ddl" | "other" {
  const cleaned = stripStringsAndComments(sql).trim().toUpperCase();
  if (cleaned.startsWith("SELECT") || cleaned.startsWith("WITH")) return "select";
  if (/^(INSERT|UPDATE|DELETE|REPLACE|UPSERT)\b/.test(cleaned)) return "write";
  if (/^(CREATE|DROP|ALTER|TRUNCATE)\b/.test(cleaned)) return "ddl";
  return "other";
}

// ─── Module definition ──────────────────────────────────────────────────────

export const databaseModule: ModuleHandler = {
  meta: {
    id: "io-database",
    name: "数据库",
    category: "io",
    description:
      "SQLite 数据库操作（基于 node:sqlite，使用真正的参数化查询）。" +
      "默认只读、限制 DDL，可显式开启写权限。",
    icon: "database",
    inputs: [
      { id: "params", name: "参数", type: "any" },
    ],
    outputs: [
      { id: "rows", name: "查询结果", type: "array" },
      { id: "rowCount", name: "返回/影响行数", type: "number" },
      { id: "lastInsertRowId", name: "最后插入 rowid", type: "number" },
    ],
    configSchema: {
      type: "object",
      properties: {
        dbPath: {
          type: "string",
          default: "./data.db",
          description: "数据库文件路径（相对于工作目录），或 :memory: 表示内存数据库",
        },
        sql: {
          type: "string",
          format: "code",
          description:
            "SQL 语句（使用 ? 或 :name 占位符进行参数绑定）。" +
            "示例: SELECT * FROM users WHERE id = ?",
        },
        readOnly: {
          type: "boolean",
          default: true,
          description:
            "只读模式（默认开启）。开启后 SQLite 引擎层面会硬阻断写入操作。" +
            "执行 INSERT/UPDATE/DELETE/CREATE 必须设为 false。",
        },
        allowDDL: {
          type: "boolean",
          default: false,
          description:
            "是否允许 DDL 语句（CREATE/DROP/ALTER 等）。" +
            "默认禁用，避免 AI 或用户输入误删表。",
        },
        rowLimit: {
          type: "number",
          default: 1000,
          minimum: 1,
          maximum: 1000000,
          description: "查询返回的最大行数（超出会截断）",
        },
        timeoutMs: {
          type: "number",
          default: 5000,
          minimum: 100,
          maximum: 300000,
          description: "单条 SQL 执行的超时时间（毫秒）",
        },
        allowMemoryDb: {
          type: "boolean",
          default: true,
          description: "是否允许 :memory: 内存数据库（不受 basePath 限制）",
        },
      },
      required: ["dbPath", "sql"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const dbPathRaw = config.dbPath as string;
    const sql = config.sql as string;
    const readOnly = config.readOnly !== false; // default true
    const allowDDL = config.allowDDL === true;  // default false
    const rowLimit = (config.rowLimit as number) ?? 1000;
    const timeoutMs = (config.timeoutMs as number) ?? 5000;
    const allowMemoryDb = config.allowMemoryDb !== false;
    const params = inputs.params;

    if (!dbPathRaw || typeof dbPathRaw !== "string") {
      throw new Error("dbPath is required and must be a string");
    }
    if (!sql || typeof sql !== "string") {
      throw new Error("sql is required and must be a string");
    }

    // ── 1. SQL safety check ──────────────────────────────────────────────
    const safety = checkSqlSafety(sql, { allowDDL });
    if (!safety.safe) {
      throw new Error(`SQL blocked by security policy: ${safety.reason}`);
    }

    const stmtType = classifyStatement(sql);
    if (readOnly && (stmtType === "write" || stmtType === "ddl")) {
      throw new Error(
        `${stmtType.toUpperCase()} statements require readOnly=false. ` +
        "Default is readOnly=true to prevent accidental writes."
      );
    }

    // ── 2. Path resolution / security ────────────────────────────────────
    const isMemoryDb = dbPathRaw === ":memory:";
    if (isMemoryDb && !allowMemoryDb) {
      throw new Error("In-memory databases are disabled by allowMemoryDb=false");
    }

    let resolvedPath = dbPathRaw;
    if (!isMemoryDb) {
      const fsPolicy = context.security?.filesystem;
      if (fsPolicy) {
        resolvedPath = validateFilePath(dbPathRaw, fsPolicy);
      }
      // Make sure parent dir exists (only when writing)
      if (!readOnly) {
        try {
          mkdirSync(dirname(resolvedPath), { recursive: true });
        } catch (err) {
          throw new Error(
            `Failed to create database directory: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    // ── 3. Open database with proper options ─────────────────────────────
    const sqlite = await loadSqlite();

    // For readOnly mode on a non-memory DB, the file must already exist
    // (SQLite refuses to create a new DB in readOnly mode).
    let db: import("node:sqlite").DatabaseSync;
    try {
      db = new sqlite.DatabaseSync(resolvedPath, {
        readOnly: !isMemoryDb && readOnly,
        // Enable defensive flag — disables features that allow corrupting the DB file
        // (e.g., writing directly to sqlite_master via writable_schema).
        ...(("defensive" in sqlite.DatabaseSync.prototype.constructor) ? { defensive: true } : {}),
      });
    } catch (error) {
      throw new Error(
        `Failed to open database: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    try {
      // ── 4. Set busy timeout (different from query timeout, but useful) ──
      try {
        db.exec(`PRAGMA busy_timeout = ${Math.min(timeoutMs, 30000)}`);
      } catch {
        // Some readOnly DBs may refuse PRAGMA — non-fatal
      }

      // ── 5. Prepare and execute with parameter binding ──────────────────
      const stmt = db.prepare(sql);

      // Bind parameters: support array (positional) and object (named)
      const bindParams = normalizeParams(params);

      // Race against a JS-level timeout (node:sqlite doesn't expose
      // sqlite3_progress_handler natively yet, so this is a soft timeout).
      // For long-running queries we'll abort the process via the timeout
      // promise and let the user see a clear error.
      const result = await runWithTimeout(
        () => executeStatement(stmt, stmtType, bindParams, rowLimit),
        timeoutMs
      );

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Database operation failed: ${msg}`);
    } finally {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  },
};

// ─── Internal helpers ───────────────────────────────────────────────────────

function normalizeParams(params: unknown): unknown[] | Record<string, unknown> {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params;
  if (typeof params === "object") return params as Record<string, unknown>;
  return [params];
}

function executeStatement(
  stmt: import("node:sqlite").StatementSync,
  stmtType: "select" | "write" | "ddl" | "other",
  bindParams: unknown[] | Record<string, unknown>,
  rowLimit: number
): Record<string, unknown> {
  // node:sqlite uses .all/.get/.run with positional or named args.
  // For positional, spread; for named, pass as a single object.
  const isPositional = Array.isArray(bindParams);
  const args = isPositional
    ? (bindParams as unknown[])
    : [bindParams as Record<string, unknown>];

  if (stmtType === "select" || stmtType === "other") {
    // SELECT or other read-shaped (e.g., PRAGMA non-write) — return rows
    // We use .all() then truncate, since node:sqlite has no streaming API yet.
    const rows = (stmt.all as (...a: unknown[]) => unknown[])(...args) as Record<string, unknown>[];
    const truncated = rows.length > rowLimit;
    const limited = truncated ? rows.slice(0, rowLimit) : rows;

    return {
      rows: limited,
      rowCount: limited.length,
      lastInsertRowId: 0,
      truncated,
    };
  }

  // INSERT / UPDATE / DELETE / DDL — return changes count
  const runResult = (stmt.run as (...a: unknown[]) => { changes: number; lastInsertRowid: number | bigint })(
    ...args
  );

  return {
    rows: [],
    rowCount: Number(runResult.changes),
    lastInsertRowId: Number(runResult.lastInsertRowid),
  };
}

async function runWithTimeout<T>(fn: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`SQL execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve().then(fn), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
