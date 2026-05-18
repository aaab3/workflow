/**
 * Database module tests.
 *
 * Covers:
 * - Real prepared statements (no SQL injection)
 * - Path validation against SecurityConfig
 * - readOnly default + write blocking
 * - DDL denylist
 * - Multi-statement rejection
 * - Row limit truncation
 * - Timeout
 * - Named and positional parameters
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { databaseModule } from "../src/modules/io/database.js";
import { createDefaultSecurityConfig } from "../src/security.js";
import type { ExecutionContext } from "../src/types.js";

let workDir: string;

function makeContext(basePath?: string): ExecutionContext {
  return {
    workflowId: "test",
    executionId: "exec",
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

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "wf-db-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("databaseModule — basic operations", () => {
  it("creates a table and inserts a row in writable mode", async () => {
    // Step 1: create table
    await databaseModule.execute(
      {},
      {
        dbPath: join(workDir, "test.db"),
        sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
        readOnly: false,
        allowDDL: true,
      },
      makeContext()
    );

    // Step 2: insert
    const insertResult = await databaseModule.execute(
      { params: ["alpha"] },
      {
        dbPath: join(workDir, "test.db"),
        sql: "INSERT INTO items (name) VALUES (?)",
        readOnly: false,
      },
      makeContext()
    );

    expect(insertResult.rowCount).toBe(1);
    expect(insertResult.lastInsertRowId).toBe(1);
  });

  it("uses real prepared statements (no SQL injection)", async () => {
    const dbPath = join(workDir, "inject.db");

    // Setup
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)", readOnly: false, allowDDL: true },
      makeContext()
    );
    await databaseModule.execute(
      { params: ["alice"] },
      { dbPath, sql: "INSERT INTO users (name) VALUES (?)", readOnly: false },
      makeContext()
    );

    // Classic SQL injection attempt: payload designed to bypass quoting
    const malicious = "alice'; DROP TABLE users; --";
    const result = await databaseModule.execute(
      { params: [malicious] },
      { dbPath, sql: "SELECT * FROM users WHERE name = ?" },
      makeContext()
    );

    // The injected string is treated as a literal, so no rows match
    expect(result.rows).toEqual([]);

    // Table still exists
    const verify = await databaseModule.execute(
      {},
      { dbPath, sql: "SELECT COUNT(*) AS c FROM users" },
      makeContext()
    );
    const rows = verify.rows as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(1);
  });

  it("supports named parameters", async () => {
    const dbPath = join(workDir, "named.db");
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE t (a INT, b TEXT)", readOnly: false, allowDDL: true },
      makeContext()
    );
    await databaseModule.execute(
      { params: { ":a": 42, ":b": "hello" } },
      { dbPath, sql: "INSERT INTO t (a, b) VALUES (:a, :b)", readOnly: false },
      makeContext()
    );

    const result = await databaseModule.execute(
      {},
      { dbPath, sql: "SELECT a, b FROM t" },
      makeContext()
    );
    const rows = result.rows as Array<{ a: number; b: string }>;
    expect(rows[0]).toEqual({ a: 42, b: "hello" });
  });
});

describe("databaseModule — security", () => {
  it("defaults to readOnly mode (writes blocked)", async () => {
    const dbPath = join(workDir, "ro.db");
    // Pre-create the DB file
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE t (a INT)", readOnly: false, allowDDL: true },
      makeContext()
    );

    // Default readOnly should reject writes
    await expect(
      databaseModule.execute(
        {},
        { dbPath, sql: "INSERT INTO t VALUES (1)" }, // no readOnly: false
        makeContext()
      )
    ).rejects.toThrow(/readOnly/i);
  });

  it("blocks DROP TABLE by default (allowDDL=false)", async () => {
    const dbPath = join(workDir, "ddl.db");
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE t (a INT)", readOnly: false, allowDDL: true },
      makeContext()
    );

    await expect(
      databaseModule.execute(
        {},
        { dbPath, sql: "DROP TABLE t", readOnly: false },
        makeContext()
      )
    ).rejects.toThrow(/blocked|drop/i);
  });

  it("blocks ALTER TABLE by default", async () => {
    const dbPath = join(workDir, "alter.db");
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE t (a INT)", readOnly: false, allowDDL: true },
      makeContext()
    );

    await expect(
      databaseModule.execute(
        {},
        { dbPath, sql: "ALTER TABLE t ADD COLUMN b TEXT", readOnly: false },
        makeContext()
      )
    ).rejects.toThrow(/blocked|alter/i);
  });

  it("blocks PRAGMA writable_schema even with allowDDL=true", async () => {
    const dbPath = join(workDir, "pragma.db");
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE t (a INT)", readOnly: false, allowDDL: true },
      makeContext()
    );

    await expect(
      databaseModule.execute(
        {},
        { dbPath, sql: "PRAGMA writable_schema = 1", readOnly: false, allowDDL: true },
        makeContext()
      )
    ).rejects.toThrow(/blocked|writable_schema/i);
  });

  it("blocks ATTACH DATABASE", async () => {
    const dbPath = join(workDir, "attach.db");
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE t (a INT)", readOnly: false, allowDDL: true },
      makeContext()
    );

    await expect(
      databaseModule.execute(
        {},
        { dbPath, sql: "ATTACH DATABASE 'evil.db' AS evil", readOnly: false, allowDDL: true },
        makeContext()
      )
    ).rejects.toThrow(/blocked|attach/i);
  });

  it("rejects multi-statement SQL", async () => {
    const dbPath = join(workDir, "multi.db");

    await expect(
      databaseModule.execute(
        {},
        {
          dbPath,
          sql: "CREATE TABLE a (x INT); CREATE TABLE b (y INT);",
          readOnly: false,
          allowDDL: true,
        },
        makeContext()
      )
    ).rejects.toThrow(/multiple|single/i);
  });

  it("blocks paths outside SecurityConfig basePath", async () => {
    const ctx = makeContext(workDir);

    await expect(
      databaseModule.execute(
        {},
        { dbPath: "../../etc/sensitive.db", sql: "SELECT 1" },
        ctx
      )
    ).rejects.toThrow(/traversal|outside/i);
  });

  it("blocks blocked-pattern paths from SecurityConfig (e.g., .env)", async () => {
    const ctx = makeContext(workDir);
    // Create the file inside basePath so traversal isn't the reason
    const fakeEnv = join(workDir, ".env");
    await writeFile(fakeEnv, "secret", "utf-8");

    await expect(
      databaseModule.execute(
        {},
        { dbPath: ".env", sql: "SELECT 1" },
        ctx
      )
    ).rejects.toThrow(/blocked/i);
  });

  it("allows :memory: even with security policy", async () => {
    const ctx = makeContext(workDir);
    const result = await databaseModule.execute(
      {},
      { dbPath: ":memory:", sql: "SELECT 1 AS one", readOnly: false },
      ctx
    );
    const rows = result.rows as Array<{ one: number }>;
    expect(rows[0]!.one).toBe(1);
  });

  it("can disable :memory: via allowMemoryDb=false", async () => {
    await expect(
      databaseModule.execute(
        {},
        { dbPath: ":memory:", sql: "SELECT 1", allowMemoryDb: false },
        makeContext()
      )
    ).rejects.toThrow(/memory/i);
  });
});

describe("databaseModule — limits", () => {
  it("truncates rows at rowLimit", async () => {
    const dbPath = join(workDir, "limit.db");
    await databaseModule.execute(
      {},
      { dbPath, sql: "CREATE TABLE t (n INT)", readOnly: false, allowDDL: true },
      makeContext()
    );
    // Insert 10 rows
    for (let i = 0; i < 10; i++) {
      await databaseModule.execute(
        { params: [i] },
        { dbPath, sql: "INSERT INTO t VALUES (?)", readOnly: false },
        makeContext()
      );
    }

    const result = await databaseModule.execute(
      {},
      { dbPath, sql: "SELECT n FROM t ORDER BY n", rowLimit: 5 },
      makeContext()
    );
    expect((result.rows as unknown[]).length).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("does not flag truncated when result fits within limit", async () => {
    const result = await databaseModule.execute(
      {},
      { dbPath: ":memory:", sql: "SELECT 1 AS a", rowLimit: 100, readOnly: false },
      makeContext()
    );
    expect(result.truncated).toBe(false);
  });
});

describe("databaseModule — input validation", () => {
  it("requires dbPath", async () => {
    await expect(
      databaseModule.execute({}, { dbPath: "", sql: "SELECT 1" }, makeContext())
    ).rejects.toThrow(/dbPath/);
  });

  it("requires sql", async () => {
    await expect(
      databaseModule.execute({}, { dbPath: ":memory:", sql: "" }, makeContext())
    ).rejects.toThrow(/sql/);
  });
});

describe("databaseModule — comment/string awareness", () => {
  it("allows DROP keyword inside a string literal in SELECT", async () => {
    // The keyword is inside a string literal, not a real DDL — should be allowed
    const result = await databaseModule.execute(
      {},
      {
        dbPath: ":memory:",
        sql: "SELECT 'this DROP is fine' AS msg",
      },
      makeContext()
    );
    const rows = result.rows as Array<{ msg: string }>;
    expect(rows[0]!.msg).toBe("this DROP is fine");
  });

  it("ignores DROP keyword inside SQL comments", async () => {
    const result = await databaseModule.execute(
      {},
      {
        dbPath: ":memory:",
        sql: "SELECT 1 AS n -- DROP TABLE x",
      },
      makeContext()
    );
    const rows = result.rows as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });
});
